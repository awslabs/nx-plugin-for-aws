/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 1: Schema acceptance matches the public option contract
 * Validates: Requirements 1.3, 1.6, 1.12, 1.13, 1.14, 1.17, 11.1, 11.8
 *
 * For all candidate names, model IDs, system prompts, allowed-tool arrays,
 * execution-limit values, infrastructure values, IaC values, placement
 * fragments, and subsets of omitted optional fields, schema acceptance
 * (the resolver returning instead of throwing) holds if and only if every
 * supplied candidate satisfies the documented required, enum, cardinality,
 * non-whitespace, positive-integer and relative-path predicates. Accepted
 * candidates resolve omitted values to the documented creation defaults
 * while omitted execution limits remain `undefined`; rejected candidates
 * throw an Error naming a violated option before the generator can mutate
 * the tree or invoke infrastructure helpers.
 */
import { joinPathFragments, type Tree } from '@nx/devkit';
import fc from 'fast-check';
import deburr from 'lodash.deburr';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { resolveAgentcoreHarnessOptions } from './resolve-options';
import type { AgentcoreHarnessGeneratorSchema } from './schema';

// ---------------------------------------------------------------------------
// Model: the formal predicates from the requirements, restated independently
// of the resolver implementation (requirements 1.3, 1.6, 1.12, 1.13, 1.17,
// 1.18 and the documented enum contract). Acceptance is the conjunction of
// every predicate over the supplied (non-`undefined`) options.
// ---------------------------------------------------------------------------

const INFRA_VALUES: readonly string[] = ['agentcore', 'none'];
const IAC_VALUES: readonly string[] = ['inherit', 'cdk', 'terraform'];

const containsNonWhitespace = (value: string): boolean => /\S/.test(value);

/**
 * A name normalizes to non-empty kebab-case / PascalCase identifiers exactly
 * when it contains at least one ASCII alphanumeric character after accent
 * transliteration (every other character is stripped by normalization).
 * Stated via `deburr` directly so the model does not call the repository's
 * `kebabCase`/`toClassName` helpers that the resolver itself uses.
 */
const normalizesToNonEmptyIdentifier = (name: string): boolean =>
  /[a-zA-Z0-9]/.test(deburr(name));

/** Non-empty relative path fragment without parent-directory traversal. */
const isRelativeNonTraversalPath = (value: string): boolean =>
  containsNonWhitespace(value) &&
  !/^[\\/]/.test(value) &&
  !/^[A-Za-z]:/.test(value) &&
  !value.split(/[\\/]/).some((segment) => segment === '..');

const isPositiveInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 1;

/**
 * Candidate options under test. Structurally identical to
 * `AgentcoreHarnessGeneratorSchema` except that `name` may be `undefined`
 * (to exercise the required-name predicate) and enum fields may carry
 * out-of-contract strings injected through explicit casts in the
 * arbitraries below. Every accepted candidate is representable by the
 * TypeScript schema interface (requirement 1.14): only deliberately
 * invalid values require casts.
 */
interface CandidateOptions {
  name: string | undefined;
  directory: string | undefined;
  subDirectory: string | undefined;
  modelId: string | undefined;
  systemPrompt: string | undefined;
  allowedTools: string[] | undefined;
  maxIterations: number | undefined;
  maxTokens: number | undefined;
  timeoutSeconds: number | undefined;
  infra: AgentcoreHarnessGeneratorSchema['infra'];
  iac: AgentcoreHarnessGeneratorSchema['iac'];
  preferInstallDependencies: boolean | undefined;
}

/**
 * Options a correct implementation must reject, per the formal predicates.
 * Empty result means the candidate must be accepted.
 */
const expectedRejectedOptions = (candidate: CandidateOptions): string[] => {
  const rejected: string[] = [];
  if (
    candidate.name === undefined ||
    !containsNonWhitespace(candidate.name) ||
    !normalizesToNonEmptyIdentifier(candidate.name)
  ) {
    rejected.push('name');
  }
  for (const option of ['directory', 'subDirectory'] as const) {
    const value = candidate[option];
    if (value !== undefined && !isRelativeNonTraversalPath(value)) {
      rejected.push(option);
    }
  }
  for (const option of ['modelId', 'systemPrompt'] as const) {
    const value = candidate[option];
    if (value !== undefined && !containsNonWhitespace(value)) {
      rejected.push(option);
    }
  }
  if (
    candidate.allowedTools !== undefined &&
    !(
      candidate.allowedTools.length >= 1 &&
      candidate.allowedTools.length <= 64 &&
      candidate.allowedTools.every((entry) => containsNonWhitespace(entry))
    )
  ) {
    rejected.push('allowedTools');
  }
  for (const option of [
    'maxIterations',
    'maxTokens',
    'timeoutSeconds',
  ] as const) {
    const value = candidate[option];
    if (value !== undefined && !isPositiveInteger(value)) {
      rejected.push(option);
    }
  }
  if (
    candidate.infra !== undefined &&
    !INFRA_VALUES.includes(candidate.infra)
  ) {
    rejected.push('infra');
  }
  if (candidate.iac !== undefined && !IAC_VALUES.includes(candidate.iac)) {
    rejected.push('iac');
  }
  return rejected;
};

// ---------------------------------------------------------------------------
// Arbitraries: per-field mixes of omitted, valid and invalid candidates so
// runs exercise both acceptance (all supplied fields valid) and rejection.
// ---------------------------------------------------------------------------

/** Empty or whitespace-only strings (violate every non-whitespace predicate). */
const arbWhitespaceOnlyString = fc.string({
  unit: fc.constantFrom(' ', '\t', '\n', '\r'),
  maxLength: 6,
});

/** Names guaranteed to contain an ASCII alphanumeric (normalize non-empty). */
const arbValidName = fc
  .tuple(
    fc.constantFrom('a', 'Z', 'harness', 'My Harness', '3d', 'x9'),
    fc.string({ maxLength: 12 }),
  )
  .map(([seed, decoration]) => seed + decoration);

/** Whitespace-only names plus symbol-only names that normalize to empty. */
const arbInvalidName = fc.oneof(
  arbWhitespaceOnlyString,
  fc.string({
    unit: fc.constantFrom('-', '_', '.', '!', '@', '#', '$', '/'),
    minLength: 1,
    maxLength: 8,
  }),
);

/** Path segments that are never the `..` traversal segment. */
const arbPathSegment = fc
  .string({
    unit: fc.constantFrom('a', 'b', 'Z', '0', '9', '_', '-', '.'),
    minLength: 1,
    maxLength: 8,
  })
  .filter((segment) => segment !== '..');

const arbValidPathFragment = fc.oneof(
  fc
    .array(arbPathSegment, { minLength: 1, maxLength: 3 })
    .map((segments) => segments.join('/')),
  // '..' only counts as traversal when it is a whole path segment.
  fc.constantFrom('packages', 'apps/nested', 'a..b'),
);

const arbInvalidPathFragment = fc.oneof(
  arbWhitespaceOnlyString,
  // Absolute paths (POSIX, UNC and drive-letter forms).
  fc.constantFrom(
    '/absolute',
    '/a/b',
    '\\server\\share',
    'C:/windows',
    'c:\\win',
    'D:relative',
  ),
  // Parent-directory traversal somewhere within the fragment.
  fc
    .tuple(
      fc.array(arbPathSegment, { maxLength: 2 }),
      fc.array(arbPathSegment, { maxLength: 2 }),
    )
    .map(([before, after]) => [...before, '..', ...after].join('/')),
);

/** Free text containing at least one non-whitespace character. */
const arbValidFreeText = fc.oneof(
  fc.string({ minLength: 1, maxLength: 30 }).filter(containsNonWhitespace),
  fc.constantFrom(
    'global.anthropic.claude-sonnet-4-6',
    'You are a helpful AI assistant.',
    'text with "quotes", \\backslashes\\ and\nnewlines',
    'unicode tëxt ✓',
  ),
);

const arbToolEntry = fc.oneof(
  fc.constant('@builtin'),
  fc.string({ minLength: 1, maxLength: 16 }).filter(containsNonWhitespace),
);

const arbValidAllowedTools = fc.oneof(
  fc.array(arbToolEntry, { minLength: 1, maxLength: 8 }),
  // The inclusive 64-entry upper bound.
  fc.constant(Array.from({ length: 64 }, (_, i) => `tool-${i}`)),
);

const arbInvalidAllowedTools = fc.oneof(
  // Cardinality violations: 0 entries or 65-70 otherwise-valid entries.
  fc.constant([] as string[]),
  fc
    .integer({ min: 65, max: 70 })
    .map((length) => Array.from({ length }, (_, i) => `tool-${i}`)),
  // Entry violation: a whitespace-only entry inside an in-bounds array.
  fc
    .tuple(
      fc.array(arbToolEntry, { maxLength: 6 }),
      arbWhitespaceOnlyString,
      fc.array(arbToolEntry, { maxLength: 6 }),
    )
    .map(([before, whitespaceEntry, after]) => [
      ...before,
      whitespaceEntry,
      ...after,
    ]),
);

const arbValidLimit = fc.integer({ min: 1, max: 2_000_000 });

const arbInvalidLimit = fc.oneof(
  // Zero and negative integers.
  fc.integer({ min: -2_000_000, max: 0 }),
  // Non-integer numbers.
  fc.constantFrom(0.5, 1.5, -2.25, 1e-3),
  fc
    .double({ min: 0.001, max: 10_000, noNaN: true })
    .filter((value) => !Number.isInteger(value)),
);

const arbValidInfra = fc.constantFrom<'agentcore' | 'none'>(
  'agentcore',
  'none',
);
const arbInvalidInfra = fc.constantFrom(
  'cdk',
  'Agentcore',
  'NONE',
  '',
  ' none',
  'all',
);
const arbValidIac = fc.constantFrom<'inherit' | 'cdk' | 'terraform'>(
  'inherit',
  'cdk',
  'terraform',
);
const arbInvalidIac = fc.constantFrom(
  'pulumi',
  'CDK',
  '',
  'agentcore',
  ' terraform',
);

/**
 * An optional option value: usually valid or omitted, occasionally invalid,
 * so around a third of generated candidates are accepted overall and the
 * rest exercise rejection across every option.
 */
const optionalField = <T>(
  valid: fc.Arbitrary<T>,
  invalid: fc.Arbitrary<unknown>,
): fc.Arbitrary<T | undefined> =>
  fc.oneof(
    { arbitrary: fc.constant(undefined), weight: 3 },
    { arbitrary: valid, weight: 6 },
    { arbitrary: invalid as fc.Arbitrary<T>, weight: 1 },
  );

const arbCandidateOptions: fc.Arbitrary<CandidateOptions> = fc.record({
  name: fc.oneof(
    { arbitrary: arbValidName, weight: 8 },
    { arbitrary: arbInvalidName, weight: 1 },
    // Omitted name exercises the required-name predicate (1.3).
    { arbitrary: fc.constant(undefined), weight: 1 },
  ),
  directory: optionalField(arbValidPathFragment, arbInvalidPathFragment),
  subDirectory: optionalField(arbValidPathFragment, arbInvalidPathFragment),
  modelId: optionalField(arbValidFreeText, arbWhitespaceOnlyString),
  systemPrompt: optionalField(arbValidFreeText, arbWhitespaceOnlyString),
  allowedTools: optionalField(arbValidAllowedTools, arbInvalidAllowedTools),
  maxIterations: optionalField(arbValidLimit, arbInvalidLimit),
  maxTokens: optionalField(arbValidLimit, arbInvalidLimit),
  timeoutSeconds: optionalField(arbValidLimit, arbInvalidLimit),
  infra: optionalField<'agentcore' | 'none'>(arbValidInfra, arbInvalidInfra),
  iac: optionalField<'inherit' | 'cdk' | 'terraform'>(
    arbValidIac,
    arbInvalidIac,
  ),
  // Never validated beyond its boolean type, so never invalid.
  preferInstallDependencies: fc.oneof(fc.constant(undefined), fc.boolean()),
});

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('agentcore-harness schema acceptance (Property 1)', () => {
  let tree: Tree;

  const snapshotChanges = (t: Tree) =>
    t
      .listChanges()
      .map(({ path, type, content }) => ({
        path,
        type,
        content: content?.toString('utf-8') ?? null,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  // Feature: agentcore-harness-generator, Property 1: Schema acceptance matches the public option contract
  // **Validates: Requirements 1.3, 1.6, 1.12, 1.13, 1.14, 1.17, 11.1, 11.8**
  it('accepts a candidate if and only if every supplied option satisfies the formal predicates', () => {
    fc.assert(
      fc.property(arbCandidateOptions, (candidate) => {
        const rejectedOptions = expectedRejectedOptions(candidate);
        const changesBefore = snapshotChanges(tree);

        if (rejectedOptions.length === 0) {
          // Acceptance must not throw: the resolver's only schema-error
          // diagnostic channel is a thrown Error, so returning normally is
          // the absence of a schema-error diagnostic (11.8).
          const resolved = resolveAgentcoreHarnessOptions(
            tree,
            candidate as AgentcoreHarnessGeneratorSchema,
          );

          // Supplied values are preserved exactly; omitted values resolve
          // to the documented creation defaults (1.14 resolution semantics).
          expect(resolved.modelId).toBe(
            candidate.modelId ?? 'global.anthropic.claude-sonnet-4-6',
          );
          expect(resolved.systemPrompt).toBe(
            candidate.systemPrompt ?? 'You are a helpful AI assistant.',
          );
          expect(resolved.allowedTools).toEqual(
            candidate.allowedTools ?? ['@builtin'],
          );
          expect(resolved.infra).toBe(candidate.infra ?? 'agentcore');
          expect(resolved.iac).toBe(candidate.iac ?? 'inherit');
          expect(resolved.preferInstallDependencies).toBe(
            candidate.preferInstallDependencies ?? true,
          );

          // Omitted execution limits remain `undefined` (provider null
          // behaviour); supplied limits are preserved exactly (1.13, 1.14).
          expect(resolved.maxIterations).toBe(candidate.maxIterations);
          expect(resolved.maxTokens).toBe(candidate.maxTokens);
          expect(resolved.timeoutSeconds).toBe(candidate.timeoutSeconds);

          // Placement defaults: join(directory ?? 'packages',
          // subDirectory ?? kebab-case name).
          expect(resolved.projectRoot).toBe(
            joinPathFragments(
              candidate.directory ?? 'packages',
              candidate.subDirectory ?? resolved.nameKebabCase,
            ),
          );
        } else {
          // Rejection must throw an Error naming a violated option (11.1).
          let thrown: unknown;
          try {
            resolveAgentcoreHarnessOptions(
              tree,
              candidate as AgentcoreHarnessGeneratorSchema,
            );
          } catch (error) {
            thrown = error;
          }
          expect(thrown).toBeInstanceOf(Error);
          const namedOption = /^Invalid option '([^']+)':/.exec(
            (thrown as Error).message,
          )?.[1];
          expect(rejectedOptions).toContain(namedOption);
        }

        // Resolution is the generator's pre-mutation stage: accepted and
        // rejected candidates alike leave the tree untouched, so rejected
        // inputs fail before any infrastructure helper can run (11.1).
        expect(snapshotChanges(tree)).toEqual(changesBefore);
      }),
      // At least 100 runs required; 250 for broader option-space coverage.
      { numRuns: 250 },
    );
  });
});
