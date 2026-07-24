/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 10: Runtime Session ID resolution respects identity and boundaries
 * Validates: Requirements 8.4, 8.5, 8.6
 *
 * For all supplied strings of length 33 through 100 inclusive, session
 * resolution returns the exact supplied string and does not call the UUID
 * generator; for all supplied strings outside those bounds, resolution
 * fails with a session-length diagnostic before invocation; when no value
 * is supplied, resolution returns the injected valid UUID from exactly one
 * generator call.
 *
 * The generated Invocation Client is template output, so this property runs
 * the generator ONCE, reads the rendered `invoke-harness.ts` from the tree,
 * transpiles the rendered TypeScript to CommonJS, and evaluates it with
 * stubbed module imports (`node:crypto`, the Powertools AppConfig reader,
 * and the AgentCore SDK client/command). The REAL exported
 * `resolveSessionId` is the unit under test: each run generates one
 * supplied `HARNESS_SESSION_ID` case (inside, outside, at the 33/100
 * boundaries, empty, or undefined) plus one injected UUID value, models
 * the required outcome from Requirements 8.4/8.5/8.6 independently of the
 * implementation, and compares the actual result, thrown diagnostic, and
 * counted generator calls against that model. The stubbed module-level
 * `node:crypto.randomUUID` THROWS on use, so UUID generation cannot leak
 * through a hidden non-injected path, and no AWS endpoint is ever
 * contacted.
 *
 * Length semantics: the bounds are measured in UTF-16 code units
 * (JavaScript `String.prototype.length`), matching the requirement's
 * "characters" as implemented. A string of 17 surrogate-pair emoji has 17
 * user-perceived characters but `.length` 34 and is therefore INSIDE the
 * bounds, while 51 emoji (`.length` 102) is OUTSIDE. The arbitraries
 * generate multi-code-unit content, including strings whose `.length` sits
 * exactly on the 33/100 boundaries built from surrogate pairs, to pin this
 * behavior.
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

/** The documented supplied-session bounds, in UTF-16 code units. */
const MIN_SESSION_ID_LENGTH = 33;
const MAX_SESSION_ID_LENGTH = 100;

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
  resolveSessionId(env: HarnessEnv, randomUuid: () => string): string;
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
 * its real exports. `resolveSessionId` receives its UUID generator as an
 * explicit argument, so every stubbed collaborator that COULD generate a
 * UUID, read configuration, or contact AWS throws on use: any such call
 * would itself falsify the generator-call-count half of the property.
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
              'resolveSessionId must use the injected UUID generator, ' +
                'never the module-level node:crypto randomUUID',
            );
          },
        };
      case '@aws-lambda-powertools/parameters/appconfig':
        return {
          getAppConfig: () => {
            throw new Error(
              'session resolution must not read Runtime Configuration',
            );
          },
        };
      case '@aws-sdk/client-bedrock-agentcore':
        return {
          BedrockAgentCoreClient: class {
            constructor() {
              throw new Error(
                'session resolution must not construct an SDK client',
              );
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
// Model: the session contract from the requirements, restated independently
// of the implementation.
//
// - 8.4: a supplied value of 33-100 code units inclusive is returned
//   EXACTLY (identity, no transformation), with zero generator calls.
// - 8.5: an absent value (undefined, or the empty string under the
//   rendered environment contract that treats '' as unset) returns the
//   injected UUID from exactly one generator call.
// - 8.6: a non-empty supplied value below 33 or above 100 code units is
//   rejected with a session-length diagnostic naming the 33/100 bounds and
//   the received length, before any generator call or AWS access.
// ---------------------------------------------------------------------------

type ExpectedOutcome =
  | { kind: 'identity' }
  | { kind: 'rejected' }
  | { kind: 'generated' };

const expectedOutcome = (supplied: string | undefined): ExpectedOutcome => {
  if (supplied === undefined || supplied === '') {
    return { kind: 'generated' };
  }
  return supplied.length >= MIN_SESSION_ID_LENGTH &&
    supplied.length <= MAX_SESSION_ID_LENGTH
    ? { kind: 'identity' }
    : { kind: 'rejected' };
};

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * One-code-unit characters spanning alphanumerics, ASCII space and tab,
 * punctuation/specials, and BMP unicode (accented, CJK, symbol). Each has
 * `String.prototype.length` 1.
 */
const SINGLE_UNIT_CHARS = [
  ...'abcXYZ019'.split(''),
  ' ',
  '\t',
  '-',
  '_',
  '.',
  '@',
  '#',
  '/',
  '\\',
  "'",
  '"',
  'é',
  'ñ',
  'ß',
  '中',
  '日',
  '☃',
];

/**
 * Two-code-unit characters (surrogate pairs). Each is ONE user-perceived
 * character with `String.prototype.length` 2, pinning that the bounds are
 * code-unit based.
 */
const SURROGATE_PAIR_CHARS = ['😀', '🚀', '🌍', '👍', '💯', '𝒜'];

/**
 * A string whose `String.prototype.length` is EXACTLY `codeUnits`, built
 * from a varied mix of one-unit characters and surrogate pairs. Each chunk
 * contributes at least one code unit; a pair that would overflow the target
 * by one unit is replaced with a one-unit filler, so the final length is
 * exact by construction.
 */
const arbStringWithExactCodeUnits = (codeUnits: number): fc.Arbitrary<string> =>
  fc
    .array(
      fc.oneof(
        { weight: 3, arbitrary: fc.constantFrom(...SINGLE_UNIT_CHARS) },
        { weight: 1, arbitrary: fc.constantFrom(...SURROGATE_PAIR_CHARS) },
      ),
      { minLength: codeUnits, maxLength: codeUnits },
    )
    .map((chunks) => {
      let built = '';
      for (const chunk of chunks) {
        if (built.length === codeUnits) {
          break;
        }
        built += built.length + chunk.length <= codeUnits ? chunk : 'x';
      }
      return built;
    });

interface SuppliedCase {
  /** Human-readable case shape surfaced in counterexamples. */
  label: string;
  /** The `HARNESS_SESSION_ID` value under test. */
  supplied: string | undefined;
}

const labelledLengthCase = (
  label: string,
  arbLength: fc.Arbitrary<number>,
): fc.Arbitrary<SuppliedCase> =>
  arbLength
    .chain((length) => arbStringWithExactCodeUnits(length))
    .map((supplied) => ({
      label: `${label} (.length ${supplied.length})`,
      supplied,
    }));

/**
 * Boundary pins built from surrogate pairs: 16 pairs + 1 single unit is 17
 * user-perceived characters at exactly `.length` 33 (inside), 16 pairs is
 * `.length` 32 (below), 50 pairs is exactly `.length` 100 (inside), and 51
 * pairs is 51 user-perceived characters at `.length` 102 (above).
 */
const arbSurrogateBoundaryCase: fc.Arbitrary<SuppliedCase> = fc
  .tuple(
    fc.constantFrom(...SURROGATE_PAIR_CHARS),
    fc.constantFrom(...SINGLE_UNIT_CHARS),
  )
  .chain(([pair, single]) =>
    fc.constantFrom<SuppliedCase>(
      {
        label: `16 surrogate pairs + 1 unit = .length 33, lower bound (${pair})`,
        supplied: pair.repeat(16) + single,
      },
      {
        label: `16 surrogate pairs = .length 32, below bound (${pair})`,
        supplied: pair.repeat(16),
      },
      {
        label: `50 surrogate pairs = .length 100, upper bound (${pair})`,
        supplied: pair.repeat(50),
      },
      {
        label: `51 surrogate pairs = .length 102, above bound (${pair})`,
        supplied: pair.repeat(51),
      },
    ),
  );

/**
 * Supplied `HARNESS_SESSION_ID` cases: absent values (undefined and the
 * empty string), below-bound lengths 1-32, the exact 32/33/100/101
 * boundaries, inside lengths 33-100, above-bound lengths 101-150, and the
 * surrogate-pair boundary pins.
 */
const arbSuppliedCase: fc.Arbitrary<SuppliedCase> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.constant<SuppliedCase>({
      label: 'undefined (absent)',
      supplied: undefined,
    }),
  },
  {
    weight: 2,
    arbitrary: fc.constant<SuppliedCase>({
      label: 'empty string (absent under the environment contract)',
      supplied: '',
    }),
  },
  {
    weight: 4,
    arbitrary: labelledLengthCase(
      'below bound',
      fc.integer({ min: 1, max: 32 }),
    ),
  },
  {
    weight: 1,
    arbitrary: labelledLengthCase('exact 32, below bound', fc.constant(32)),
  },
  {
    weight: 2,
    arbitrary: labelledLengthCase('exact 33, lower bound', fc.constant(33)),
  },
  {
    weight: 5,
    arbitrary: labelledLengthCase(
      'inside bounds',
      fc.integer({ min: 33, max: 100 }),
    ),
  },
  {
    weight: 2,
    arbitrary: labelledLengthCase('exact 100, upper bound', fc.constant(100)),
  },
  {
    weight: 1,
    arbitrary: labelledLengthCase('exact 101, above bound', fc.constant(101)),
  },
  {
    weight: 3,
    arbitrary: labelledLengthCase(
      'above bound',
      fc.integer({ min: 101, max: 150 }),
    ),
  },
  { weight: 2, arbitrary: arbSurrogateBoundaryCase },
);

/**
 * Injected UUID values: UUID-format strings dominate, plus arbitrary
 * 36-code-unit strings - Requirement 8.5 requires returning whatever the
 * generator produced, verbatim.
 */
const arbInjectedUuid: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.uuid() },
  {
    weight: 1,
    arbitrary: fc.string({
      unit: fc.constantFrom(...SINGLE_UNIT_CHARS),
      minLength: 36,
      maxLength: 36,
    }),
  },
);

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('agentcore-harness Runtime Session ID resolution (Property 10)', () => {
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

  // Feature: agentcore-harness-generator, Property 10: Runtime Session ID resolution respects identity and boundaries
  // **Validates: Requirements 8.4, 8.5, 8.6**
  it('resolves every supplied value per the identity/rejection/generation model', () => {
    fc.assert(
      fc.property(
        arbSuppliedCase,
        arbInjectedUuid,
        (suppliedCase, injectedUuid) => {
          // Counting generator stub: the only legal UUID source.
          let generatorCalls = 0;
          const randomUuid = (): string => {
            generatorCalls += 1;
            return injectedUuid;
          };
          const env: HarnessEnv = {
            HARNESS_SESSION_ID: suppliedCase.supplied,
          };

          // Exactly one invocation of the REAL rendered function per run,
          // so the counted generator calls are exact.
          let resolved: string | undefined;
          let failure: Error | undefined;
          try {
            resolved = client.resolveSessionId(env, randomUuid);
          } catch (error) {
            failure = error as Error;
          }

          const expected = expectedOutcome(suppliedCase.supplied);
          switch (expected.kind) {
            case 'identity': {
              // 8.4: the supplied value is returned EXACTLY - identity,
              // no trimming, no normalization - with zero generator calls.
              expect(failure).toBeUndefined();
              expect(resolved).toBe(suppliedCase.supplied);
              expect(generatorCalls).toBe(0);
              break;
            }
            case 'rejected': {
              // 8.6: the session-length diagnostic names the 33/100
              // bounds and the received code-unit length, and the
              // generator is never consulted.
              const supplied = suppliedCase.supplied as string;
              expect(resolved).toBeUndefined();
              expect(failure).toBeInstanceOf(Error);
              expect(failure?.message).toContain(`${MIN_SESSION_ID_LENGTH}`);
              expect(failure?.message).toContain(`${MAX_SESSION_ID_LENGTH}`);
              expect(failure?.message).toContain(`received ${supplied.length}`);
              expect(generatorCalls).toBe(0);
              break;
            }
            case 'generated': {
              // 8.5: an absent value produces the injected UUID from
              // exactly one generator call.
              expect(failure).toBeUndefined();
              expect(resolved).toBe(injectedUuid);
              expect(generatorCalls).toBe(1);
              break;
            }
          }
        },
      ),
      // At least 100 runs required; 300 across the identity/rejection/
      // generation branches (cheap per-run direct function calls).
      { numRuns: 300 },
    );
  });
});
