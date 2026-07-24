/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 2: Normalization produces safe, deterministic project identity
 * Validates: Requirements 1.15, 1.18, 1.19, 2.1, 2.5
 *
 * For all valid human-readable Harness names and valid relative placement
 * options, resolution produces the same non-empty kebab-case project name,
 * non-empty PascalCase Runtime Configuration segment, scoped project
 * identifier, metadata values, and traversal-free root
 * `join(directory ?? 'packages', subDirectory ?? nameKebabCase)` on every
 * execution; invalid placement or unusable normalization fails before tree
 * mutation.
 */
import {
  joinPathFragments,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import fc from 'fast-check';
import deburr from 'lodash.deburr';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import {
  AGENTCORE_HARNESS_GENERATOR_INFO,
  agentcoreHarnessGenerator,
  readAgentCoreHarnessMetadata,
} from './generator';
import {
  DEFAULT_HARNESS_ALLOWED_TOOLS,
  DEFAULT_HARNESS_MODEL_ID,
  DEFAULT_HARNESS_SYSTEM_PROMPT,
  resolveAgentcoreHarnessOptions,
} from './resolve-options';

// ---------------------------------------------------------------------------
// Model: the identity contract from the requirements, restated independently
// of the resolver implementation.
//
// - 1.15: the project root is exactly
//   `join(directory ?? 'packages', subDirectory ?? <kebab-case-name>)`.
// - 1.18: placement fragments are relative and traversal-free, so the
//   resolved root can never escape the workspace.
// - 1.19: a name whose normalization yields an empty kebab-case/PascalCase
//   identifier is rejected before the Nx tree is modified.
// - 2.1/2.5: the created project carries the workspace npm scope, the
//   kebab-case name, the normalized root, and Generator metadata recording
//   the identifier, normalized name, Runtime Configuration segment, model
//   ID, and `iam` authorization mode.
// ---------------------------------------------------------------------------

/** Workspace npm scope prefix established by `createTreeWithEmptyWorkspace`. */
const NPM_SCOPE_PREFIX = '@proj/';

/** Non-empty kebab-case: lowercase alphanumeric runs joined by single '-'. */
const KEBAB_CASE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Non-empty PascalCase identifier: an uppercase letter, or the `_<digit>`
 * prefix the repository's `toClassName` emits for digit-leading names so the
 * Runtime Configuration segment stays a valid identifier.
 */
const CLASS_NAME_PATTERN = /^(?:[A-Z]|_[0-9])[A-Za-z0-9]*$/;

/**
 * A name normalizes to a non-empty identifier exactly when it contains at
 * least one ASCII alphanumeric after accent transliteration. Stated via
 * `deburr` directly so the model does not call the repository's
 * `kebabCase`/`toClassName` helpers that the resolver itself uses.
 */
const normalizesToNonEmptyIdentifier = (name: string): boolean =>
  /[a-zA-Z0-9]/.test(deburr(name));

/** Assert a resolved root is relative and free of parent-directory traversal. */
const expectTraversalFreeRelativeRoot = (root: string): void => {
  expect(root).not.toMatch(/^[\\/]/);
  expect(root).not.toMatch(/^[A-Za-z]:/);
  expect(root.split(/[\\/]/)).not.toContain('..');
};

/** Candidate identity options: a name plus optional placement fragments. */
interface IdentityCandidate {
  name: string;
  directory: string | undefined;
  subDirectory: string | undefined;
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Valid human-readable names. Seeds cover the interesting normalization
 * shapes (spaces, camelCase humps, digit-leading words, accents, embedded
 * punctuation); arbitrary decoration exercises everything else while the
 * seed guarantees the name normalizes to a non-empty identifier.
 */
const arbValidName = fc
  .tuple(
    fc.constantFrom(
      'harness',
      'My Harness',
      'myHarness2',
      '3d',
      'café',
      'a_b.c',
      'Z',
      'x9/y',
    ),
    fc.string({ maxLength: 12 }),
  )
  .map(([seed, decoration]) => seed + decoration);

/** Names that contain non-whitespace yet normalize to empty identifiers (1.19). */
const arbUnusableName = fc
  .oneof(
    fc.string({
      unit: fc.constantFrom('-', '_', '.', '!', '@', '#', '$', '/'),
      minLength: 1,
      maxLength: 8,
    }),
    // deburr transliterates only Latin-based accents, so these keep no
    // ASCII alphanumerics and normalize to empty identifiers.
    fc.constantFrom('日本語', 'привет', '🙂🙂', '---', '_._'),
  )
  .filter((name) => /\S/.test(name) && !normalizesToNonEmptyIdentifier(name));

/** Path segments that are never the `..` traversal segment. */
const arbPathSegment = fc
  .string({
    unit: fc.constantFrom('a', 'b', 'Z', '0', '9', '_', '-', '.'),
    minLength: 1,
    maxLength: 8,
  })
  .filter((segment) => segment !== '..');

/** Valid relative placement fragments, including separator/dot edge cases. */
const arbValidPathFragment = fc.oneof(
  fc
    .array(arbPathSegment, { minLength: 1, maxLength: 3 })
    .map((segments) => segments.join('/')),
  // '..' only counts as traversal when it is a whole path segment; '.'
  // segments and backslash separators are valid and must normalize safely.
  fc.constantFrom('packages', 'apps/nested', 'a..b', 'nested\\win', './dotted'),
);

/** Empty or whitespace-only strings (invalid as placement fragments). */
const arbWhitespaceOnlyString = fc.string({
  unit: fc.constantFrom(' ', '\t', '\n', '\r'),
  maxLength: 6,
});

/** Placement fragments the Generator must reject (1.18). */
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

const arbValidIdentityCandidate: fc.Arbitrary<IdentityCandidate> = fc.record({
  name: arbValidName,
  directory: fc.option(arbValidPathFragment, { nil: undefined }),
  subDirectory: fc.option(arbValidPathFragment, { nil: undefined }),
});

/**
 * A candidate that is valid except for exactly one injected fault, so the
 * rejection diagnostic must name precisely the faulted option.
 */
const arbFaultedCandidate = fc
  .record({
    base: arbValidIdentityCandidate,
    fault: fc.constantFrom<'name' | 'directory' | 'subDirectory'>(
      'name',
      'directory',
      'subDirectory',
    ),
    unusableName: arbUnusableName,
    invalidFragment: arbInvalidPathFragment,
  })
  .map(({ base, fault, unusableName, invalidFragment }) => ({
    fault,
    candidate: {
      ...base,
      ...(fault === 'name'
        ? { name: unusableName }
        : { [fault]: invalidFragment }),
    } as IdentityCandidate,
  }));

/**
 * Placement fragments for full generator runs: plain segments without '.'
 * characters so the resolved root is a regular nested directory rather than
 * a degenerate workspace-root placement.
 */
const arbGeneratorPlacement = fc
  .array(
    fc.string({
      unit: fc.constantFrom('a', 'b', 'z', '0', '9', '_', '-'),
      minLength: 1,
      maxLength: 6,
    }),
    { minLength: 1, maxLength: 2 },
  )
  .map((segments) => segments.join('/'));

const arbGeneratorIdentityCandidate: fc.Arbitrary<IdentityCandidate> =
  fc.record({
    name: arbValidName,
    directory: fc.option(arbGeneratorPlacement, { nil: undefined }),
    subDirectory: fc.option(arbGeneratorPlacement, { nil: undefined }),
  });

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('agentcore-harness normalized project identity (Property 2)', () => {
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

  // Feature: agentcore-harness-generator, Property 2: Normalization produces safe, deterministic project identity
  // **Validates: Requirements 1.15, 1.18, 1.19, 2.1, 2.5**
  it('resolves every valid name and relative placement to the same safe project identity on every execution', () => {
    fc.assert(
      fc.property(arbValidIdentityCandidate, (candidate) => {
        const changesBefore = snapshotChanges(tree);

        const resolved = resolveAgentcoreHarnessOptions(tree, candidate);
        const resolvedAgain = resolveAgentcoreHarnessOptions(tree, candidate);

        // Determinism: the same input resolves to deeply equal identity on
        // every execution.
        expect(resolvedAgain).toStrictEqual(resolved);

        // Non-empty normalized identifiers (1.19 acceptance side).
        expect(resolved.nameKebabCase).toMatch(KEBAB_CASE_PATTERN);
        expect(resolved.nameClassName).toMatch(CLASS_NAME_PATTERN);

        // Scoped project identifier: workspace npm scope + kebab-case name
        // (2.1 identity feed).
        expect(resolved.fullyQualifiedProjectName).toBe(
          `${NPM_SCOPE_PREFIX}${resolved.nameKebabCase}`,
        );

        // Exact placement formula (1.15).
        expect(resolved.projectRoot).toBe(
          joinPathFragments(
            candidate.directory ?? 'packages',
            candidate.subDirectory ?? resolved.nameKebabCase,
          ),
        );

        // The resolved root is relative and traversal-free (1.18), so it
        // stays within the workspace.
        expectTraversalFreeRelativeRoot(resolved.projectRoot);

        // Runtime Configuration segments (2.5): exactly
        // `agentcore.harnesses.<ClassName>`.
        expect(resolved.runtimeConfigPath).toBe(
          `agentcore.harnesses.${resolved.nameClassName}`,
        );
        expect(resolved.runtimeConfigPath.split('.')).toEqual([
          'agentcore',
          'harnesses',
          resolved.nameClassName,
        ]);

        // Metadata identity values recorded at creation (2.5): IAM is the
        // only MVP authorization mode.
        expect(resolved.auth).toBe('iam');

        // Resolution is the pre-mutation stage: it never touches the tree.
        expect(snapshotChanges(tree)).toEqual(changesBefore);
      }),
      // At least 100 runs required; 250 for broader identity coverage.
      { numRuns: 250 },
    );
  });

  // Feature: agentcore-harness-generator, Property 2: Normalization produces safe, deterministic project identity
  // **Validates: Requirements 1.15, 1.18, 1.19, 2.1, 2.5**
  it('rejects invalid placement or unusable normalization before any tree mutation', async () => {
    await fc.assert(
      fc.asyncProperty(arbFaultedCandidate, async ({ fault, candidate }) => {
        const changesBefore = snapshotChanges(tree);

        // Run the full generator so the property proves rejection happens
        // before project mutation, not merely inside the resolver.
        let thrown: unknown;
        try {
          await agentcoreHarnessGenerator(tree, candidate);
        } catch (error) {
          thrown = error;
        }

        // The diagnostic names exactly the faulted option (1.18, 1.19).
        expect(thrown).toBeInstanceOf(Error);
        const namedOption = /^Invalid option '([^']+)':/.exec(
          (thrown as Error).message,
        )?.[1];
        expect(namedOption).toBe(fault);

        // The Nx tree is byte-for-byte unchanged: rejection precedes every
        // mutation (1.19).
        expect(snapshotChanges(tree)).toEqual(changesBefore);
      }),
      // At least 100 runs required; 250 across the three fault kinds.
      { numRuns: 250 },
    );
  });

  // Feature: agentcore-harness-generator, Property 2: Normalization produces safe, deterministic project identity
  // **Validates: Requirements 1.15, 1.18, 1.19, 2.1, 2.5**
  it('creates the Nx application project and Generator metadata from the resolved identity', async () => {
    // Full generator runs are comparatively slow (template rendering and
    // formatting), so this end-to-end reinforcement uses a bounded run
    // count; the >=100-run requirement is satisfied by the resolver-level
    // properties above. `infra: none` keeps each run scoped to the
    // standalone project surfaces that Requirements 2.1/2.5 describe.
    await fc.assert(
      fc.asyncProperty(arbGeneratorIdentityCandidate, async (candidate) => {
        const freshTree = createTreeUsingTsSolutionSetup();
        const resolved = resolveAgentcoreHarnessOptions(freshTree, candidate);

        await agentcoreHarnessGenerator(freshTree, {
          ...candidate,
          infra: 'none',
        });

        // The project exists under the scoped kebab-case name with the
        // normalized root (2.1).
        const project = readProjectConfiguration(
          freshTree,
          resolved.fullyQualifiedProjectName,
        );
        expect(project.name).toBe(
          `${NPM_SCOPE_PREFIX}${resolved.nameKebabCase}`,
        );
        expect(project.projectType).toBe('application');
        expect(project.root).toBe(resolved.projectRoot);
        expect(project.root).toBe(
          joinPathFragments(
            candidate.directory ?? 'packages',
            candidate.subDirectory ?? resolved.nameKebabCase,
          ),
        );
        expectTraversalFreeRelativeRoot(project.root);

        // Project files land at the resolved root.
        expect(
          freshTree.exists(joinPathFragments(project.root, 'project.json')),
        ).toBe(true);
        expect(
          freshTree.exists(joinPathFragments(project.root, 'invoke.ts')),
        ).toBe(true);

        // Complete Generator metadata is recorded (2.5): identifier,
        // normalized name, Runtime Configuration segment, model ID, and
        // `iam` authorization mode.
        const metadata = readAgentCoreHarnessMetadata(project);
        expect(metadata.generator).toBe(AGENTCORE_HARNESS_GENERATOR_INFO.id);
        expect(metadata.name).toBe(resolved.nameKebabCase);
        expect(metadata.rc).toBe(resolved.nameClassName);
        expect(metadata.runtimeConfigPath).toBe(
          `agentcore.harnesses.${resolved.nameClassName}`,
        );
        expect(metadata.modelId).toBe(DEFAULT_HARNESS_MODEL_ID);
        expect(metadata.systemPrompt).toBe(DEFAULT_HARNESS_SYSTEM_PROMPT);
        expect(metadata.allowedTools).toEqual([
          ...DEFAULT_HARNESS_ALLOWED_TOOLS,
        ]);
        expect(metadata.auth).toBe('iam');

        // Resolution remains deterministic after generation, so reruns
        // derive the same identity.
        expect(
          resolveAgentcoreHarnessOptions(freshTree, candidate),
        ).toStrictEqual(resolved);
      }),
      { numRuns: 25 },
    );
  });
});
