/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 11: Prompt mapping preserves user text exactly
 * Validates: Requirements 8.8, 8.9
 *
 * For all arrays of zero or more prompt arguments, CLI parsing joins the
 * arguments with single ASCII spaces and trims the result; when the result
 * is non-whitespace, request construction creates exactly one
 * `InvokeHarness` request whose messages equal exactly one user message
 * with exactly one text content block holding that normalized result -
 * exact string equality, including internal whitespace runs, Unicode,
 * combining characters, and shell-metacharacter look-alikes - and when the
 * result is empty, the run fails with usage guidance BEFORE any
 * collaborator call: no UUID generation, no Runtime Configuration read, no
 * SDK client construction, and no send (Requirement 8.9).
 *
 * The generated Invocation Client is template output, so this property runs
 * the generator ONCE, reads BOTH rendered files (`invoke.ts` and
 * `invoke-harness.ts`) from the tree, transpiles the rendered TypeScript to
 * CommonJS, and evaluates it. The FULL rendered pipeline is the unit under
 * test: each run evaluates the real `invoke.ts` CLI wrapper against a
 * synthetic `process` carrying the generated argv (so the REAL rendered
 * join/trim expression executes), and the wrapper's stubbed
 * `./invoke-harness` import routes the joined prompt into the REAL
 * evaluated `runHarnessCli`, composed through its dependency-injection
 * seam with recording collaborators (environment, io, UUID generator,
 * Runtime Configuration reader, and an SDK client whose recording `send`
 * returns successful stream events). Each run models the required outcome
 * independently of the implementation - expected prompt =
 * `args.join(' ').trim()`, empty means rejection - and compares the
 * synthetic exit code (0 accepted / 1 rejected), stderr diagnostics,
 * recorded collaborator calls, and the exact recorded
 * `InvokeHarnessCommand` input against that model. The stubbed
 * module-level `node:crypto`, AppConfig reader, and SDK client class THROW
 * on use, so no hidden non-injected path can satisfy the property, and no
 * AWS endpoint or credential source is ever contacted.
 */
import fc from 'fast-check';
import ts from 'typescript';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { agentcoreHarnessGenerator } from './generator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Generated identity: name 'my-harness' -> class 'MyHarness'. */
const PROJECT_ROOT = 'packages/my-harness';
/** The usage guidance names the generated invoke target (Requirement 8.9). */
const INVOKE_TARGET = 'nx run @proj/my-harness:invoke';

const HARNESS_ARN =
  'arn:aws:bedrock-agentcore:us-west-2:123456789012:harness/my-harness-abc';

/** UUID returned by the injected generator (36 chars, inside 33-100). */
const STUB_UUID = '00000000-0000-4000-8000-000000000000';

/** Complete happy-path stream so accepted runs finish with exit code 0. */
const SUCCESS_EVENTS: ReadonlyArray<Record<string, unknown>> = [
  { messageStart: { role: 'assistant' } },
  { contentBlockStart: { contentBlockIndex: 0 } },
  { contentBlockDelta: { contentBlockIndex: 0, delta: { text: 'ok' } } },
  { contentBlockStop: { contentBlockIndex: 0 } },
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

/** Typed view of the evaluated `invoke-harness.ts` export under test. */
interface InvocationClientModule {
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
 * its real exports. Every collaborator is injected per run through
 * `RunHarnessCliDeps`, so each stubbed module-level fallback that COULD
 * generate a UUID, read configuration, or construct an SDK client throws on
 * use: any such call would itself falsify the pre-call-rejection half of
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
              'runHarnessCli must use the injected Runtime Configuration ' +
                'reader, never the default AppConfig reader',
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
// Recording collaborators for the accepted/rejected pipeline
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
 * interaction. The environment supplies a usable direct `HARNESS_ARN`, so
 * had a blank prompt NOT been rejected first, the pipeline would have
 * proceeded through UUID generation, Region parsing, client construction,
 * and send - making zero recorded calls strong pre-call-rejection evidence.
 */
const makeRecordingDeps = () => {
  const recorder: RunRecorder = {
    stdout: [],
    stderr: [],
    uuidCalls: 0,
    readCalls: [],
    createdRegions: [],
    sentCommands: [],
  };
  const env: HarnessEnv = { HARNESS_ARN };
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
// Model: the prompt-mapping contract from the requirements, restated
// independently of the implementation.
//
// - 8.8: the CLI joins every argument after the script path with one ASCII
//   space and trims the result. A non-empty normalized prompt is sent as
//   EXACTLY one user message with EXACTLY one text content block equal to
//   the normalized prompt, in exactly one InvokeHarness request. Internal
//   whitespace runs (including doubled spaces produced by empty-string
//   arguments), Unicode, combining characters, and metacharacter
//   look-alikes survive verbatim.
// - 8.9: an empty normalized prompt (empty argv, or every argument
//   whitespace-only/empty) fails with usage guidance and exit code 1
//   before any collaborator call - no UUID, no Runtime Configuration read,
//   no client construction, no send.
//
// "Trim" is JavaScript `String.prototype.trim`: ASCII space/tab/newline
// AND Unicode whitespace such as NBSP (\u00A0) and ZWNBSP (\uFEFF) are
// trimmable, while whitespace look-alikes outside the WhiteSpace
// production, such as ZWSP (\u200B), are content and must be preserved.
// ---------------------------------------------------------------------------

const modelNormalizedPrompt = (argv: readonly string[]): string =>
  argv.join(' ').trim();

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Ordinary prompt words. */
const ORDINARY_WORDS = [
  'hello',
  'world',
  'ship',
  'it',
  'x',
  'Reinvent2025',
  'a1',
];

/**
 * Unicode fragments: CJK, emoji/surrogate pairs (including a ZWJ family
 * sequence), combining characters, accented Latin, and a ZWSP-embedded
 * word (ZWSP is NOT JavaScript whitespace and must survive verbatim).
 */
const UNICODE_FRAGMENTS = [
  'こんにちは',
  '世界',
  '中文提示',
  '한국어',
  'Grüße',
  'café',
  '🚀',
  '😀💯',
  '🌍🌎🌏',
  'e\u0301clair',
  'a\u0308b',
  '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}',
  '\u200Bzero\u200Bwidth',
];

/**
 * Special characters: quotes, backslashes, backticks, `${}` interpolation
 * look-alikes, subshell/pipe/redirect/glob shell metacharacters, and
 * flag-shaped arguments (the CLI treats argv purely as prompt text).
 */
const SPECIAL_FRAGMENTS = [
  '"double"',
  "'single'",
  'C:\\path\\to\\x',
  '`backticks`',
  '${jndi:ldap://x}',
  '${env:HOME}',
  '$(subshell)',
  '&&',
  '||',
  ';semi;',
  '|pipe|',
  '>out',
  '<in',
  '*glob?',
  '!bang',
  '#hash',
  '--flag',
  '-n',
  '~tilde',
  '%percent%',
];

/**
 * Whitespace-only and empty arguments. All of these are JS-trimmable, so
 * an argv built ONLY from them normalizes to the empty prompt; mixed into
 * content argv they contribute join separators and trimmable padding.
 */
const WHITESPACE_ONLY_ARGS = [
  '',
  ' ',
  '  ',
  '\t',
  '\n',
  '\r\n',
  ' \t ',
  '\t\n',
  '   \n\t  ',
  '\u00A0',
  '\uFEFF',
  ' \u00A0\t',
];

/** Non-whitespace content chunks used to build compound arguments. */
const arbContentChunk = fc.constantFrom(
  ...ORDINARY_WORDS,
  ...UNICODE_FRAGMENTS,
  ...SPECIAL_FRAGMENTS,
);

const arbWhitespaceRun = (minLength: number, maxLength: number) =>
  fc.string({
    unit: fc.constantFrom(' ', '\t', '\n'),
    minLength,
    maxLength,
  });

/**
 * One argument containing an INTERNAL whitespace run (multiple spaces,
 * tabs, newlines). Internal whitespace sits strictly between non-blank
 * content, so it must survive the outer join/trim verbatim.
 */
const arbInternalWhitespaceArg = fc
  .tuple(arbContentChunk, arbWhitespaceRun(1, 3), arbContentChunk)
  .map(([left, run, right]) => `${left}${run}${right}`);

/** One argument padded with leading/trailing whitespace around content. */
const arbPaddedArg = fc
  .tuple(arbWhitespaceRun(0, 2), arbContentChunk, arbWhitespaceRun(0, 2))
  .map(([lead, chunk, trail]) => `${lead}${chunk}${trail}`);

/**
 * Free-form hostile strings mixing quotes, backslashes, dollar/brace,
 * shell metacharacters, whitespace, combining marks, ZWSP, and surrogate
 * pairs at the character level.
 */
const arbMixedArg = fc.string({
  unit: fc.constantFrom(
    ...'abcXYZ019'.split(''),
    ' ',
    '\t',
    '"',
    "'",
    '\\',
    '`',
    '$',
    '{',
    '}',
    '(',
    ')',
    ';',
    '|',
    '&',
    '<',
    '>',
    '*',
    'é',
    '中',
    '日',
    '☃',
    '😀',
    '🚀',
    '\u0301',
    '\u200B',
  ),
  maxLength: 12,
});

/** One prompt argument drawn across every hostile category. */
const arbPromptArg = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(...ORDINARY_WORDS) },
  { weight: 3, arbitrary: fc.constantFrom(...UNICODE_FRAGMENTS) },
  { weight: 3, arbitrary: fc.constantFrom(...SPECIAL_FRAGMENTS) },
  { weight: 2, arbitrary: arbInternalWhitespaceArg },
  { weight: 2, arbitrary: arbPaddedArg },
  { weight: 2, arbitrary: fc.constantFrom(...WHITESPACE_ONLY_ARGS) },
  { weight: 2, arbitrary: arbMixedArg },
);

/**
 * Argv cases: general 1-8 argument arrays (mostly accepted, sometimes
 * all-whitespace by chance), the empty argv, and dedicated
 * whitespace-only arrays so the Requirement 8.9 rejection branch is
 * exercised on every shape of blank input.
 */
const arbArgvCase: fc.Arbitrary<string[]> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.array(arbPromptArg, { minLength: 1, maxLength: 8 }),
  },
  { weight: 1, arbitrary: fc.constant<string[]>([]) },
  {
    weight: 2,
    arbitrary: fc.array(fc.constantFrom(...WHITESPACE_ONLY_ARGS), {
      minLength: 1,
      maxLength: 4,
    }),
  },
);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('agentcore-harness prompt request mapping (Property 11)', () => {
  let cliJs: string;
  let client: InvocationClientModule;

  beforeAll(async () => {
    // One real generator run renders both Invocation Client files;
    // `infra: none` keeps the run project-only.
    const tree = createTreeUsingTsSolutionSetup();
    await agentcoreHarnessGenerator(tree, {
      name: 'my-harness',
      infra: 'none',
    });

    const renderedImpl = tree.read(
      `${PROJECT_ROOT}/invoke-harness.ts`,
      'utf-8',
    ) as string;
    const renderedCli = tree.read(
      `${PROJECT_ROOT}/invoke.ts`,
      'utf-8',
    ) as string;
    expect(renderedImpl).toBeTruthy();
    expect(renderedCli).toBeTruthy();

    client = evaluateInvokeHarnessModule(renderedImpl);
    cliJs = transpileToCjs(renderedCli);
  });

  /**
   * Evaluate the rendered `invoke.ts` CLI wrapper with a synthetic process
   * (argv/exitCode), a synthetic console, and the supplied runHarnessCli
   * implementation, then wait for its promise chain to settle. The REAL
   * rendered argv join/trim expression executes inside the wrapper.
   */
  const runCliWrapper = async (
    argv: readonly string[],
    runHarnessCli: (prompt: string) => Promise<number>,
  ) => {
    const prompts: string[] = [];
    const consoleErrors: string[] = [];
    const fakeProcess = {
      argv: ['node', 'invoke.ts', ...argv],
      exitCode: undefined as number | undefined,
    };
    const requireStub = (specifier: string): unknown => {
      if (specifier === './invoke-harness') {
        return {
          runHarnessCli: (prompt: string) => {
            prompts.push(prompt);
            return runHarnessCli(prompt);
          },
        };
      }
      throw new Error(`unexpected import '${specifier}' in rendered invoke.ts`);
    };
    const exportsObject: Record<string, unknown> = {};
    new Function('require', 'exports', 'module', 'process', 'console', cliJs)(
      requireStub,
      exportsObject,
      { exports: exportsObject },
      fakeProcess,
      { error: (message: unknown) => consoleErrors.push(String(message)) },
    );
    // The wrapper settles through .then/.catch microtasks; one macrotask
    // flush guarantees completion for immediately-settling implementations.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { prompts, consoleErrors, exitCode: fakeProcess.exitCode };
  };

  // Feature: agentcore-harness-generator, Property 11: Prompt mapping preserves user text exactly
  // **Validates: Requirements 8.8, 8.9**
  it('maps every argv array to the exact joined/trimmed request or a pre-call rejection', async () => {
    await fc.assert(
      fc.asyncProperty(arbArgvCase, async (argv) => {
        const expectedPrompt = modelNormalizedPrompt(argv);
        const { deps, recorder } = makeRecordingDeps();

        // Full pipeline per run: the real rendered CLI wrapper feeds the
        // real rendered runHarnessCli through recording collaborators.
        const { prompts, consoleErrors, exitCode } = await runCliWrapper(
          argv,
          (prompt) => client.runHarnessCli(prompt, deps),
        );

        // 8.8: the wrapper calls runHarnessCli exactly once with exactly
        // the modeled join/trim result, for accepted and rejected argv
        // alike - the REAL rendered join/trim expression is under test.
        expect(prompts).toEqual([expectedPrompt]);

        if (expectedPrompt === '') {
          // 8.9: an empty normalized prompt (empty argv, or every
          // argument whitespace-only/empty) maps to usage guidance
          // naming the invoke target and exit code 1, with ZERO
          // collaborator calls: no UUID, no Runtime Configuration read,
          // no client construction, no send, and nothing on stdout.
          expect(exitCode).toBe(1);
          expect(consoleErrors).toHaveLength(1);
          expect(consoleErrors[0]).toContain(INVOKE_TARGET);
          expect(recorder.uuidCalls).toBe(0);
          expect(recorder.readCalls).toEqual([]);
          expect(recorder.createdRegions).toEqual([]);
          expect(recorder.sentCommands).toEqual([]);
          expect(recorder.stdout).toEqual([]);
        } else {
          // 8.8: exactly one send whose command carries exactly one user
          // message with exactly one text block equal to the normalized
          // prompt - exact string equality, preserving internal
          // whitespace runs and every Unicode/special character.
          expect(exitCode).toBe(0);
          expect(consoleErrors).toEqual([]);
          expect(recorder.sentCommands).toHaveLength(1);
          const command = recorder.sentCommands[0];
          expect(command).toBeInstanceOf(RecordedInvokeHarnessCommand);
          expect(command.input.messages).toEqual([
            { role: 'user', content: [{ text: expectedPrompt }] },
          ]);
          const messages = command.input.messages as Array<{
            content: Array<{ text: string }>;
          }>;
          expect(messages[0].content[0].text).toBe(expectedPrompt);
        }
      }),
      // At least 150 runs required by the task; 200 across the accepted/
      // rejected branches (each run evaluates the tiny transpiled wrapper
      // plus direct function calls, so runs stay cheap).
      { numRuns: 200 },
    );
  });
});
