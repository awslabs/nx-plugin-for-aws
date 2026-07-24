/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 12: Harness ARN parsing is partition-independent and rejects unusable input
 * Validates: Requirements 8.10, 11.6
 *
 * For all syntactically valid Harness ARNs with non-empty Regions, region
 * parsing returns the ARN Region segment exactly, regardless of partition
 * or account - including arbitrary partition-shaped tokens no real
 * partition uses and resource identifiers containing extra colons; for all
 * malformed or regionless candidates (empty strings, non-`arn` prefixes,
 * truncated forms with fewer than six segments, empty Region segments, and
 * Region segments containing characters outside `[A-Za-z0-9-]`), parsing
 * fails with an ARN diagnostic naming the candidate and the expected form
 * BEFORE any AWS SDK client exists.
 *
 * The generated Invocation Client is template output, so this property runs
 * the generator ONCE, reads the rendered `invoke-harness.ts` from the tree,
 * transpiles the rendered TypeScript to CommonJS, and evaluates it with
 * stubbed module imports (`node:crypto`, the Powertools AppConfig reader,
 * and the AgentCore SDK client/command). The REAL exported
 * `parseHarnessRegion` is the primary unit under test: each run generates
 * one valid or unusable candidate, models the required outcome from
 * Requirements 8.10/11.6 independently of the implementation (constructive
 * generation puts every candidate in a known class), and compares the
 * actual extraction or thrown diagnostic against that model. Each run also
 * composes the SAME candidate through the REAL rendered `runHarnessCli`
 * with recording collaborators: for valid ARNs the injected client factory
 * must receive EXACTLY the extracted Region (no fixed Region anywhere,
 * Requirement 8.10), and for unusable ARNs the run must fail with zero
 * `createClient` calls and zero sends (pre-call failure, Requirement
 * 11.6). The stubbed module-level `node:crypto`, AppConfig reader, and SDK
 * client class THROW on use, so no hidden non-injected path can satisfy
 * the property, and no AWS endpoint or credential source is ever
 * contacted.
 */
import fc from 'fast-check';
import ts from 'typescript';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { agentcoreHarnessGenerator } from './generator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Generated identity: name 'my-harness'. */
const PROJECT_ROOT = 'packages/my-harness';

/** The ARN diagnostic names the expected Harness ARN form (11.6). */
const EXPECTED_ARN_FORM =
  "'arn:<partition>:bedrock-agentcore:<region>:<account>:harness/<id>'";

/** UUID returned by the injected generator (36 chars, inside 33-100). */
const STUB_UUID = '00000000-0000-4000-8000-000000000000';

/** Complete happy-path stream so valid composed runs finish with exit 0. */
const SUCCESS_EVENTS: ReadonlyArray<Record<string, unknown>> = [
  { messageStart: { role: 'assistant' } },
  { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'ok' } } },
  { messageStop: { stopReason: 'end_turn' } },
];

// ---------------------------------------------------------------------------
// Rendered-module evaluation
// ---------------------------------------------------------------------------

interface HarnessEnv {
  HARNESS_ARN?: string;
  HARNESS_SESSION_ID?: string;
  RUNTIME_CONFIG_APP_ID?: string;
}

/** Typed view of the evaluated `invoke-harness.ts` exports under test. */
interface InvocationClientModule {
  parseHarnessRegion(harnessArn: string): string;
  runHarnessCli(
    prompt: string,
    deps?: Record<string, unknown>,
  ): Promise<number>;
}

/** Records every `new InvokeHarnessCommand(input)` the client constructs. */
class RecordedInvokeHarnessCommand {
  constructor(readonly input: Record<string, unknown>) {}
}

const transpileToCjs = (source: string): string =>
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;

/**
 * Evaluate the rendered `invoke-harness.ts` with stubbed imports and return
 * its real exports. `parseHarnessRegion` is a pure function of its
 * argument, and the composed pipeline injects every collaborator through
 * `RunHarnessCliDeps`, so each stubbed module-level fallback that COULD
 * generate a UUID, read configuration, or construct an SDK client throws
 * on use: any such call would itself falsify the pre-call-failure half of
 * the property. Only `InvokeHarnessCommand` is a recording class, because
 * request construction flows through the module-level import by design.
 */
const evaluateInvokeHarnessModule = (
  source: string,
): InvocationClientModule => {
  const requireStub = (specifier: string): unknown => {
    switch (specifier) {
      case 'node:crypto':
        return {
          randomUUID: () => {
            throw new Error(
              'runHarnessCli must use the injected UUID generator, never ' +
                'the module-level node:crypto randomUUID',
            );
          },
        };
      case '@aws-lambda-powertools/parameters/appconfig':
        return {
          getAppConfig: () => {
            throw new Error(
              'ARN parsing must never read Runtime Configuration through ' +
                'the default AppConfig reader',
            );
          },
        };
      case '@aws-sdk/client-bedrock-agentcore':
        return {
          BedrockAgentCoreClient: class {
            constructor() {
              throw new Error(
                'runHarnessCli must use the injected client factory, never ' +
                  'the real SDK client',
              );
            }
          },
          InvokeHarnessCommand: RecordedInvokeHarnessCommand,
        };
      default:
        throw new Error(
          `unexpected import '${specifier}' in rendered invoke-harness.ts`,
        );
    }
  };

  const exportsObject: Record<string, unknown> = {};
  new Function('require', 'exports', 'module', transpileToCjs(source))(
    requireStub,
    exportsObject,
    { exports: exportsObject },
  );
  return exportsObject as unknown as InvocationClientModule;
};

// ---------------------------------------------------------------------------
// Recording collaborators for the composed valid/invalid pipeline
// ---------------------------------------------------------------------------

interface RunRecorder {
  stdout: string[];
  stderr: string[];
  uuidCalls: number;
  readCalls: string[];
  createdRegions: string[];
  sentCommands: RecordedInvokeHarnessCommand[];
}

/**
 * Build a full `RunHarnessCliDeps` object whose collaborators record every
 * interaction, with the candidate ARN supplied as the direct
 * `HARNESS_ARN`. A successful send returns a complete event stream, so a
 * valid candidate drives the pipeline to exit code 0 while the recorded
 * `createClient` Regions expose exactly what the ARN parser produced; an
 * unusable candidate must leave BOTH `createdRegions` and `sentCommands`
 * empty, which is the Requirement 11.6 pre-call failure evidence.
 */
const makeRecordingDeps = (harnessArn: string) => {
  const recorder: RunRecorder = {
    stdout: [],
    stderr: [],
    uuidCalls: 0,
    readCalls: [],
    createdRegions: [],
    sentCommands: [],
  };
  const env: HarnessEnv = { HARNESS_ARN: harnessArn };
  const deps = {
    env,
    io: {
      writeStdout: (text: string) => {
        recorder.stdout.push(text);
      },
      writeStderr: (text: string) => {
        recorder.stderr.push(text);
      },
    },
    randomUuid: () => {
      recorder.uuidCalls += 1;
      return STUB_UUID;
    },
    readRuntimeConfig: (application: string): Promise<unknown> => {
      recorder.readCalls.push(application);
      return Promise.resolve(undefined);
    },
    createClient: (region: string) => {
      recorder.createdRegions.push(region);
      return {
        send: async (command: RecordedInvokeHarnessCommand) => {
          recorder.sentCommands.push(command);
          return {
            stream: {
              async *[Symbol.asyncIterator]() {
                for (const event of SUCCESS_EVENTS) {
                  yield event;
                }
              },
            },
          };
        },
      };
    },
  };
  return { deps, recorder };
};

// ---------------------------------------------------------------------------
// Model: the ARN-parsing contract from the requirements, restated
// independently of the implementation.
//
// - 8.10: the Region required by the resolved Harness ARN is DERIVED from
//   the ARN - the fourth colon-separated segment - with no fixed Region
//   embedded anywhere. Derivation is partition- and account-independent:
//   for every candidate of the form
//   `arn:<partition>:<service>:<region>:<account>:<resource>` whose Region
//   segment is non-empty and matches `[A-Za-z0-9-]+`, parsing returns
//   EXACTLY that Region segment, for known partitions, arbitrary
//   partition-shaped tokens, and resource identifiers that contain extra
//   colons (the Region stays segment index 3).
// - 11.6: a candidate lacking a usable Region segment - empty string, a
//   first segment other than exactly `arn`, fewer than six segments (even
//   when segment index 3 holds a plausible Region), an empty Region
//   segment, or a Region segment with characters outside `[A-Za-z0-9-]` -
//   fails with an ARN diagnostic that names the candidate and the expected
//   form, BEFORE any AWS SDK client is constructed or any request is sent.
//
// Candidates are generated constructively into known classes (every
// generated token is colon-free unless the class is specifically about
// colon placement), so the expected outcome follows from the class rather
// than from re-running the parsing logic under test.
// ---------------------------------------------------------------------------

interface ValidArnCase {
  kind: 'valid';
  /** Human-readable case shape surfaced in counterexamples. */
  label: string;
  /** The candidate Harness ARN under test. */
  arn: string;
  /** The exact Region segment the parser must return. */
  region: string;
}

interface InvalidArnCase {
  kind: 'invalid';
  /** Human-readable case shape surfaced in counterexamples. */
  label: string;
  /** The unusable candidate under test. */
  arn: string;
}

type ArnCase = ValidArnCase | InvalidArnCase;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const ALNUM_CHARS = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
];

/** Characters a usable Region segment may contain: `[A-Za-z0-9-]`. */
const REGION_CHARS = [...ALNUM_CHARS, '-'];

/**
 * Colon-free characters a Region segment must NOT contain: whitespace,
 * underscores, punctuation, and Unicode including surrogate pairs. `:` is
 * deliberately excluded - a colon inside a "Region" token would shift the
 * segment boundaries instead of producing an invalid Region segment.
 */
const INVALID_REGION_CHARS = [
  ' ',
  '\t',
  '_',
  '.',
  '/',
  '#',
  '$',
  '*',
  'é',
  '中',
  '☃',
  '😀',
];

/**
 * Partition tokens: the real partitions plus arbitrary partition-shaped
 * tokens plus tokens no real partition would ever use (uppercase,
 * underscores, dots, Unicode). Partition-independence means the parser
 * never inspects this segment, so ALL of them must extract identically.
 * Every token is non-empty and colon-free so the Region stays segment 3.
 */
const arbPartitionToken = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom('aws', 'aws-cn', 'aws-us-gov', 'aws-iso-b'),
  },
  {
    weight: 2,
    arbitrary: fc.string({
      unit: fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyz0123456789-'.split(''),
      ),
      minLength: 1,
      maxLength: 12,
    }),
  },
  {
    weight: 1,
    arbitrary: fc.constantFrom('AWS', 'aws_x', 'foo.bar', 'πartition', '0'),
  },
);

/**
 * Usable Region tokens: realistic Regions plus arbitrary non-empty
 * `[A-Za-z0-9-]+` tokens (the full character class the rendered parser
 * documents, including uppercase and hyphen-only shapes).
 */
const arbRegionToken = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      'us-east-1',
      'us-west-2',
      'eu-central-1',
      'cn-north-1',
      'us-gov-west-1',
      'ap-southeast-2',
      'us-isob-east-1',
    ),
  },
  {
    weight: 2,
    arbitrary: fc.string({
      unit: fc.constantFrom(...REGION_CHARS),
      minLength: 1,
      maxLength: 20,
    }),
  },
);

/** Account segments: non-empty digit runs (typically twelve digits). */
const arbAccount = fc.string({
  unit: fc.constantFrom(...'0123456789'.split('')),
  minLength: 1,
  maxLength: 14,
});

const arbResourceId = fc.string({
  unit: fc.constantFrom(...ALNUM_CHARS, '-'),
  minLength: 1,
  maxLength: 16,
});

/**
 * Resource segments: plain `harness/<id>` plus identifiers containing
 * extra colons. Resource colons push the candidate above six segments and
 * pin that the Region is still read from segment index 3.
 */
const arbResourceSegment = fc.oneof(
  {
    weight: 3,
    arbitrary: arbResourceId.map((id) => ({
      label: 'plain resource',
      value: `harness/${id}`,
    })),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(
        arbResourceId,
        fc.array(arbResourceId, { minLength: 1, maxLength: 3 }),
      )
      .map(([id, extras]) => ({
        label: 'colon-bearing resource (>6 segments)',
        value: `harness/${id}:${extras.join(':')}`,
      })),
  },
);

/** Valid candidates: exact extraction of the Region segment is required. */
const arbValidCase: fc.Arbitrary<ValidArnCase> = fc
  .tuple(arbPartitionToken, arbRegionToken, arbAccount, arbResourceSegment)
  .map(([partition, region, account, resource]) => ({
    kind: 'valid' as const,
    label: `valid ARN, partition '${partition}', ${resource.label}`,
    arn: `arn:${partition}:bedrock-agentcore:${region}:${account}:${resource.value}`,
    region,
  }));

/**
 * First segments other than exactly `arn`: other prefixes, case variants,
 * whitespace-mangled variants, and an empty first segment. The remainder
 * of the candidate is otherwise well-formed, so ONLY the prefix is at
 * fault.
 */
const arbNonArnPrefixCase: fc.Arbitrary<InvalidArnCase> = fc
  .tuple(
    fc.constantFrom('xrn', 'ARN', 'Arn', ' arn', 'arn ', 'urn', 'aws', ''),
    arbRegionToken,
    arbAccount,
    arbResourceId,
  )
  .map(([prefix, region, account, id]) => ({
    kind: 'invalid' as const,
    label: `non-arn first segment '${prefix}'`,
    arn: `${prefix}:aws:bedrock-agentcore:${region}:${account}:harness/${id}`,
  }));

/**
 * Colon-free text: at most one segment, so it can never carry a Region -
 * including the bare token `arn` itself.
 */
const arbNoColonTextCase: fc.Arbitrary<InvalidArnCase> = fc
  .oneof(
    fc.constant('arn'),
    fc.string({
      unit: fc.constantFrom(...ALNUM_CHARS, ' ', '-', '_', '.'),
      minLength: 1,
      maxLength: 24,
    }),
  )
  .map((text) => ({
    kind: 'invalid' as const,
    label: 'colon-free text',
    arn: text,
  }));

/**
 * Truncated forms: a correct `arn` prefix but fewer than six segments.
 * The four- and five-segment shapes place a plausible Region at segment
 * index 3, pinning that segment count alone rejects the candidate.
 */
const arbTruncatedCase: fc.Arbitrary<InvalidArnCase> = fc
  .tuple(
    arbPartitionToken,
    arbRegionToken,
    arbAccount,
    fc.integer({ min: 2, max: 5 }),
  )
  .map(([partition, region, account, segmentCount]) => {
    const segments = [
      'arn',
      partition,
      'bedrock-agentcore',
      region,
      account,
    ].slice(0, segmentCount);
    return {
      kind: 'invalid' as const,
      label: `truncated to ${segmentCount} segments`,
      arn: segments.join(':'),
    };
  });

/** Regionless candidates: six segments with an EMPTY Region segment. */
const arbEmptyRegionCase: fc.Arbitrary<InvalidArnCase> = fc
  .tuple(arbPartitionToken, arbAccount, arbResourceId)
  .map(([partition, account, id]) => ({
    kind: 'invalid' as const,
    label: 'empty Region segment',
    arn: `arn:${partition}:bedrock-agentcore::${account}:harness/${id}`,
  }));

/**
 * Region segments containing at least one character outside
 * `[A-Za-z0-9-]`: spaces, tabs, underscores, punctuation, and Unicode.
 * Colon-free by construction so the mangled token stays segment index 3.
 */
const arbInvalidCharRegionCase: fc.Arbitrary<InvalidArnCase> = fc
  .tuple(
    fc.string({ unit: fc.constantFrom(...REGION_CHARS), maxLength: 8 }),
    fc.constantFrom(...INVALID_REGION_CHARS),
    fc.string({
      unit: fc.constantFrom(...REGION_CHARS, ...INVALID_REGION_CHARS),
      maxLength: 8,
    }),
    arbPartitionToken,
    arbAccount,
    arbResourceId,
  )
  .map(([head, bad, tail, partition, account, id]) => ({
    kind: 'invalid' as const,
    label: `Region with invalid character(s) '${head}${bad}${tail}'`,
    arn: `arn:${partition}:bedrock-agentcore:${head}${bad}${tail}:${account}:harness/${id}`,
  }));

/**
 * The full candidate space: valid candidates (including colon-bearing
 * resources) and every unusable class named by Requirement 11.6 coverage.
 */
const arbArnCase: fc.Arbitrary<ArnCase> = fc.oneof(
  { weight: 6, arbitrary: arbValidCase },
  {
    weight: 1,
    arbitrary: fc.constant<InvalidArnCase>({
      kind: 'invalid',
      label: 'empty string',
      arn: '',
    }),
  },
  { weight: 2, arbitrary: arbNonArnPrefixCase },
  { weight: 1, arbitrary: arbNoColonTextCase },
  { weight: 2, arbitrary: arbTruncatedCase },
  { weight: 1, arbitrary: arbEmptyRegionCase },
  { weight: 2, arbitrary: arbInvalidCharRegionCase },
);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('agentcore-harness Harness ARN parsing (Property 12)', () => {
  let client: InvocationClientModule;

  beforeAll(async () => {
    // One real generator run renders the Invocation Client; `infra: none`
    // keeps the run project-only.
    const tree = createTreeUsingTsSolutionSetup();
    await agentcoreHarnessGenerator(tree, {
      name: 'my-harness',
      infra: 'none',
    });

    const renderedImpl = tree.read(
      `${PROJECT_ROOT}/invoke-harness.ts`,
      'utf-8',
    ) as string;
    expect(renderedImpl).toBeTruthy();

    client = evaluateInvokeHarnessModule(renderedImpl);
  });

  // Feature: agentcore-harness-generator, Property 12: Harness ARN parsing is partition-independent and rejects unusable input
  // **Validates: Requirements 8.10, 11.6**
  it('extracts exactly the Region from every valid candidate and rejects every unusable candidate before any SDK call', async () => {
    await fc.assert(
      fc.asyncProperty(arbArnCase, async (arnCase) => {
        // --- Direct call of the REAL rendered parseHarnessRegion ---
        let parsed: string | undefined;
        let parseFailure: Error | undefined;
        try {
          parsed = client.parseHarnessRegion(arnCase.arn);
        } catch (error) {
          parseFailure = error as Error;
        }

        if (arnCase.kind === 'valid') {
          // 8.10: EXACT extraction of the Region segment, independent of
          // partition, account, and resource-colon count.
          expect(parseFailure).toBeUndefined();
          expect(parsed).toBe(arnCase.region);
        } else {
          // 11.6: the ARN diagnostic names the candidate and the expected
          // Harness ARN form.
          expect(parsed).toBeUndefined();
          expect(parseFailure).toBeInstanceOf(Error);
          expect(parseFailure?.message).toContain('Region');
          expect(parseFailure?.message).toContain(arnCase.arn);
          expect(parseFailure?.message).toContain(EXPECTED_ARN_FORM);
        }

        // --- Composed pipeline through the REAL rendered runHarnessCli ---
        // The empty string is treated as an absent HARNESS_ARN by
        // discovery (Property 9 territory) and never reaches ARN parsing
        // through the pipeline; the direct call above already covers it.
        if (arnCase.arn === '') {
          return;
        }

        const { deps, recorder } = makeRecordingDeps(arnCase.arn);
        let exitCode: number | undefined;
        let cliFailure: Error | undefined;
        try {
          exitCode = await client.runHarnessCli('Hello harness', deps);
        } catch (error) {
          cliFailure = error as Error;
        }

        if (arnCase.kind === 'valid') {
          // 8.10 composed: the injected client factory receives EXACTLY
          // the Region extracted from the resolved ARN - no fixed Region
          // exists anywhere in the pipeline - and exactly one request
          // carries the ARN unchanged.
          expect(cliFailure).toBeUndefined();
          expect(exitCode).toBe(0);
          expect(recorder.createdRegions).toEqual([arnCase.region]);
          expect(recorder.sentCommands).toHaveLength(1);
          expect(recorder.sentCommands[0].input.harnessArn).toBe(arnCase.arn);
        } else {
          // 11.6 composed: pre-call failure - the ARN diagnostic aborts
          // the run BEFORE any SDK client exists: zero createClient
          // calls, zero sends, and nothing streamed to stdout.
          expect(exitCode).toBeUndefined();
          expect(cliFailure).toBeInstanceOf(Error);
          expect(cliFailure?.message).toContain('Region');
          expect(recorder.createdRegions).toEqual([]);
          expect(recorder.sentCommands).toEqual([]);
          expect(recorder.stdout).toEqual([]);
        }
      }),
      // At least 200 runs required by the task; each run is a cheap direct
      // parse call plus one composed pipeline call against the transpiled
      // module, so 250 runs stay fast.
      { numRuns: 250 },
    );
  });
});
