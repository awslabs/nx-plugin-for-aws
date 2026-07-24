/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 9: Direct ARN discovery has deterministic precedence
 * Validates: Requirements 8.1, 8.2, 11.5
 *
 * For all non-empty direct Harness ARNs, Runtime Configuration application
 * IDs, and Runtime Configuration maps, ARN discovery returns the direct ARN
 * without calling Runtime Configuration; when the direct ARN is absent,
 * discovery returns exactly the generated Runtime Configuration key's value
 * or a missing-key error.
 *
 * The generated Invocation Client is template output, so this property runs
 * the generator ONCE, reads the rendered `invoke-harness.ts` from the tree,
 * transpiles the rendered TypeScript to CommonJS, and evaluates it with
 * stubbed module imports (`node:crypto`, the Powertools AppConfig reader,
 * and the AgentCore SDK client/command). The REAL exported
 * `resolveHarnessArn` is the unit under test: each run generates one
 * environment (direct value x application ID) and one Runtime Configuration
 * document shape, models the required outcome from Requirements
 * 8.1/8.2/8.3/11.5 independently of the implementation, and compares the
 * actual resolution, thrown diagnostic, and recorded reader calls against
 * that model. The stubbed default AppConfig reader and SDK client THROW on
 * use, so lookup suppression cannot be faked through a hidden non-injected
 * read path, and no AWS endpoint or credential source is ever contacted.
 */
import fc from 'fast-check';
import ts from 'typescript';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { agentcoreHarnessGenerator } from './generator';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Generated identity: name 'my-harness' -> class 'MyHarness'. */
const RUNTIME_CONFIG_KEY = 'MyHarness';
const PROJECT_ROOT = 'packages/my-harness';

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
  resolveHarnessArn(
    env: HarnessEnv,
    readRuntimeConfig: (application: string) => Promise<unknown>,
  ): Promise<string>;
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
 * its real exports. `resolveHarnessArn` receives its Runtime Configuration
 * reader as an explicit argument, so every stubbed collaborator that COULD
 * read configuration or contact AWS throws on use: any such call would
 * itself falsify the lookup-suppression half of the property.
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
              'ARN discovery must not generate a UUID; only session ' +
                'resolution may (Property 10 territory)',
            );
          },
        };
      case '@aws-lambda-powertools/parameters/appconfig':
        return {
          getAppConfig: () => {
            throw new Error(
              'resolveHarnessArn must use the injected reader, never the ' +
                'default AppConfig reader',
            );
          },
        };
      case '@aws-sdk/client-bedrock-agentcore':
        return {
          BedrockAgentCoreClient: class {
            constructor() {
              throw new Error('ARN discovery must not construct an SDK client');
            }
          },
          InvokeHarnessCommand: class {
            constructor(readonly input: Record<string, unknown>) {}
          },
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
// Model: the discovery contract from the requirements, restated
// independently of the implementation.
//
// - 8.1: a non-empty HARNESS_ARN is used directly, without reading Runtime
//   Configuration. The rendered environment contract treats empty strings
//   as absent, so `HARNESS_ARN=` falls back rather than sending ''.
// - 8.2: with HARNESS_ARN absent and RUNTIME_CONFIG_APP_ID present, the
//   ARN is resolved from `agentcore.harnesses.<ClassName>` of exactly that
//   application's document - the stored value, unmodified, via exactly one
//   reader call.
// - 8.3: with neither source present, discovery fails before any lookup,
//   naming both HARNESS_ARN and RUNTIME_CONFIG_APP_ID as remediation.
// - 11.5: a lookup result lacking a usable generated Harness entry fails,
//   identifying the missing Runtime Configuration Key
//   `agentcore.harnesses.<ClassName>`.
// ---------------------------------------------------------------------------

/** The environment contract: empty strings count as absent (8.1 boundary). */
const isPresent = (value: string | undefined): value is string =>
  value !== undefined && value !== '';

interface DocCase {
  /** Human-readable document shape surfaced in counterexamples. */
  label: string;
  /** The parsed Runtime Configuration document the reader resolves with. */
  doc: unknown;
  /**
   * The exact non-empty value at `agentcore.harnesses.MyHarness`, when the
   * document contains one; `undefined` for every unusable shape.
   */
  resolvableArn?: string;
}

type ExpectedOutcome =
  | { kind: 'direct'; arn: string }
  | { kind: 'fallback'; arn: string }
  | { kind: 'missing-key-error' }
  | { kind: 'no-source-error' };

const expectedOutcome = (
  direct: string | undefined,
  appId: string | undefined,
  docCase: DocCase,
): ExpectedOutcome => {
  if (isPresent(direct)) {
    return { kind: 'direct', arn: direct };
  }
  if (!isPresent(appId)) {
    return { kind: 'no-source-error' };
  }
  return docCase.resolvableArn !== undefined
    ? { kind: 'fallback', arn: docCase.resolvableArn }
    : { kind: 'missing-key-error' };
};

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const ALNUM_CHARS = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
];

/** Realistic Harness ARNs across partitions, Regions, and accounts. */
const arbHarnessArn = fc
  .tuple(
    fc.constantFrom('aws', 'aws-cn', 'aws-us-gov'),
    fc.constantFrom(
      'us-east-1',
      'us-west-2',
      'eu-central-1',
      'cn-north-1',
      'us-gov-west-1',
      'ap-southeast-2',
    ),
    fc.string({
      unit: fc.constantFrom(...'0123456789'.split('')),
      minLength: 12,
      maxLength: 12,
    }),
    fc.string({
      unit: fc.constantFrom(...ALNUM_CHARS, '-'),
      minLength: 1,
      maxLength: 16,
    }),
  )
  .map(
    ([partition, region, account, id]) =>
      `arn:${partition}:bedrock-agentcore:${region}:${account}:harness/${id}`,
  );

/**
 * Non-empty direct values. Requirement 8.1 quantifies over "a non-empty
 * value", not over syntactically valid ARNs (ARN validation is downstream
 * Property 12 territory), so ARN-shaped values dominate but adversarial
 * non-empty strings - whitespace, non-ARN text - must suppress the lookup
 * identically.
 */
const arbNonEmptyDirect = fc.oneof(
  { weight: 4, arbitrary: arbHarnessArn },
  { weight: 1, arbitrary: fc.constantFrom(' ', '\t', 'not-an-arn', '0') },
  { weight: 1, arbitrary: fc.string({ minLength: 1, maxLength: 24 }) },
);

/** Direct value: non-empty ARN-ish string, empty string, or undefined. */
const arbDirectValue = fc.oneof(
  { weight: 3, arbitrary: arbNonEmptyDirect },
  { weight: 2, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constant('') },
);

/** Application ID: app-id-ish string, empty string, or undefined. */
const arbAppIdValue = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.string({
      unit: fc.constantFrom(...ALNUM_CHARS, '-'),
      minLength: 1,
      maxLength: 16,
    }),
  },
  { weight: 1, arbitrary: fc.constant(undefined) },
  { weight: 1, arbitrary: fc.constant('') },
);

/**
 * Sibling harness class names (`_?[A-Za-z0-9]+` superset of `toClassName`
 * output), never colliding with the generated key.
 */
const arbSiblingClassName = fc
  .tuple(
    fc.constantFrom('', '_'),
    fc.string({
      unit: fc.constantFrom(...ALNUM_CHARS),
      minLength: 1,
      maxLength: 16,
    }),
  )
  .map(([prefix, body]) => prefix + body)
  .filter((className) => className !== RUNTIME_CONFIG_KEY);

/** Sibling entry values: other harness ARNs or arbitrary opaque strings. */
const arbSiblingValue = fc.oneof(arbHarnessArn, fc.string({ maxLength: 12 }));

/** A harnesses map of zero or more sibling entries (distinct keys). */
const arbSiblingHarnessMap = fc
  .uniqueArray(fc.tuple(arbSiblingClassName, arbSiblingValue), {
    maxLength: 4,
    selector: ([className]) => className,
  })
  .map((entries) => Object.fromEntries(entries) as Record<string, string>);

/** Sibling `agentcore` namespaces other generators own (gateways etc.). */
const arbSiblingNamespaces = fc
  .uniqueArray(
    fc.tuple(
      fc.constantFrom('gateways', 'runtimes', 'memories'),
      fc.oneof(arbHarnessArn, arbSiblingHarnessMap),
    ),
    { maxLength: 2, selector: ([namespaceKey]) => namespaceKey },
  )
  .map((entries) => Object.fromEntries(entries) as Record<string, unknown>);

/**
 * Runtime Configuration document shapes: one resolvable shape (a
 * well-formed document containing a non-empty MyHarness entry among
 * arbitrary siblings) and every unusable shape named by Requirement 11.5
 * coverage - a sibling-only harnesses map, an empty harnesses map, an
 * empty document, null, undefined, and a MyHarness entry holding ''.
 */
const arbDocCase: fc.Arbitrary<DocCase> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc
      .tuple(arbHarnessArn, arbSiblingHarnessMap, arbSiblingNamespaces)
      .map(([arn, siblings, namespaces]) => ({
        label: 'harnesses map containing the MyHarness entry',
        doc: {
          ...namespaces,
          harnesses: { ...siblings, [RUNTIME_CONFIG_KEY]: arn },
        },
        resolvableArn: arn,
      })),
  },
  {
    weight: 2,
    arbitrary: fc
      .tuple(
        arbSiblingHarnessMap.filter(
          (siblings) => Object.keys(siblings).length > 0,
        ),
        arbSiblingNamespaces,
      )
      .map(([siblings, namespaces]) => ({
        label: 'harnesses map without the MyHarness entry',
        doc: { ...namespaces, harnesses: siblings },
      })),
  },
  {
    weight: 1,
    arbitrary: fc.constant<DocCase>({
      label: 'empty harnesses map',
      doc: { harnesses: {} },
    }),
  },
  {
    weight: 1,
    arbitrary: fc.constant<DocCase>({ label: 'empty document', doc: {} }),
  },
  {
    weight: 1,
    arbitrary: fc.constant<DocCase>({ label: 'null document', doc: null }),
  },
  {
    weight: 1,
    arbitrary: fc.constant<DocCase>({
      label: 'undefined document',
      doc: undefined,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.tuple(arbSiblingHarnessMap).map(([siblings]) => ({
      label: 'MyHarness entry holding an empty string',
      doc: { harnesses: { ...siblings, [RUNTIME_CONFIG_KEY]: '' } },
    })),
  },
);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('agentcore-harness ARN discovery precedence (Property 9)', () => {
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

  // Feature: agentcore-harness-generator, Property 9: Direct ARN discovery has deterministic precedence
  // **Validates: Requirements 8.1, 8.2, 11.5**
  it('resolves every direct value, application ID, and document shape per the precedence model', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbDirectValue,
        arbAppIdValue,
        arbDocCase,
        async (direct, appId, docCase) => {
          // Recording reader stub: the only legal Runtime Configuration
          // read path, resolving with the generated document.
          const readCalls: string[] = [];
          const readRuntimeConfig = (application: string): Promise<unknown> => {
            readCalls.push(application);
            return Promise.resolve(docCase.doc);
          };
          const env: HarnessEnv = {
            HARNESS_ARN: direct,
            RUNTIME_CONFIG_APP_ID: appId,
          };

          // Exactly one invocation of the REAL rendered function per run,
          // so the recorded reader call counts are exact.
          let resolved: string | undefined;
          let failure: Error | undefined;
          try {
            resolved = await client.resolveHarnessArn(env, readRuntimeConfig);
          } catch (error) {
            failure = error as Error;
          }

          const expected = expectedOutcome(direct, appId, docCase);
          switch (expected.kind) {
            case 'direct': {
              // 8.1: the direct value wins verbatim, and the lookup is
              // suppressed - zero reader calls for every document shape.
              expect(failure).toBeUndefined();
              expect(resolved).toBe(expected.arn);
              expect(readCalls).toEqual([]);
              break;
            }
            case 'fallback': {
              // 8.2: exactly one read of exactly the configured
              // application, resolving to exactly the stored value.
              expect(failure).toBeUndefined();
              expect(resolved).toBe(expected.arn);
              expect(readCalls).toEqual([appId]);
              break;
            }
            case 'missing-key-error': {
              // 11.5: the lookup happened (once, with the app ID), and the
              // diagnostic identifies the missing Runtime Configuration
              // Key for every unusable document shape.
              expect(resolved).toBeUndefined();
              expect(failure).toBeInstanceOf(Error);
              expect(failure?.message).toContain(
                `agentcore.harnesses.${RUNTIME_CONFIG_KEY}`,
              );
              expect(readCalls).toEqual([appId]);
              break;
            }
            case 'no-source-error': {
              // 8.3: no source at all fails before any lookup, naming both
              // remediation options.
              expect(resolved).toBeUndefined();
              expect(failure).toBeInstanceOf(Error);
              expect(failure?.message).toContain('HARNESS_ARN');
              expect(failure?.message).toContain('RUNTIME_CONFIG_APP_ID');
              expect(readCalls).toEqual([]);
              break;
            }
          }
        },
      ),
      // At least 100 runs required; 300 across the direct/fallback/error
      // branches (cheap per-run direct function calls).
      { numRuns: 300 },
    );
  });
});
