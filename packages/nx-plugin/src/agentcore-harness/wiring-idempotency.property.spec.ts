/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 15: Generator-Owned Wiring reruns are idempotent
 * Validates: Requirements 10.1, 10.5, 10.11
 *
 * For all valid Generator option sets and compatible initial workspaces,
 * applying the Generator twice with equivalent options yields a canonical
 * tree after the second run that is identical to the canonical tree after
 * the first run, including one semantic copy of every required
 * Generator-Owned Wiring entry.
 *
 * "Equivalent options" covers both rerun shapes the preflight defines:
 * (a) the identical raw options, and (b) the same options with any subset
 * of the persisted creation options (modelId, systemPrompt, allowedTools,
 * maxIterations, maxTokens, timeoutSeconds) omitted — persisted
 * Generator-owned metadata is authoritative for omitted options on
 * compatible reruns, so both shapes resolve to the same effective run.
 * Project identity and placement (name, directory, subDirectory) and the
 * infrastructure selection (infra, iac) are not persisted metadata, so the
 * rerun repeats them verbatim.
 *
 * Compared after run 1 vs run 2:
 * - the canonical full tree: every (path, change type, content) from the
 *   in-memory tree's change set, sorted by path (10.1's "no file-content
 *   changes after repository-standard formatting" — both runs end with the
 *   repository formatter);
 * - the project configuration read back through readProjectConfiguration
 *   (10.1's "no project-configuration changes");
 * - the root package.json dependency sections (dependency wiring is merge
 *   wiring, not file templating).
 *
 * Wiring singletons after the second run (10.5, 10.11): exactly one
 * project configuration for the Harness, exactly one semantic copy of each
 * CDK star export, exactly one Runtime Configuration registration in the
 * provider artifact, and exactly one Harness metric tag in the shared
 * infrastructure metrics surface.
 *
 * SCOPE: this property measures Generator-Owned Wiring idempotence and
 * deduplication ONLY. It never edits generated files between runs, so its
 * success is NOT User-Owned File preservation evidence — that boundary is
 * established independently by Property 16 (task 4.11) with its own
 * fixtures and assertions.
 *
 * Runtime note: every case is two complete generator runs (template
 * rendering plus repository-standard formatting) against a fresh
 * workspace. 100 runs ≈ 200 generator executions, which measured locally
 * stays within the suite's per-test budget with the explicit timeout
 * below.
 */
import {
  getProjects,
  readJson,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import fc from 'fast-check';
import type { IacOption } from '../utils/iac';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import {
  AGENTCORE_HARNESS_GENERATOR_INFO,
  agentcoreHarnessGenerator,
} from './generator';
import { resolveAgentcoreHarnessOptions } from './resolve-options';
import type { AgentcoreHarnessGeneratorSchema } from './schema';

// ---------------------------------------------------------------------------
// Model: the idempotency contract from the requirements, restated
// independently of the generator implementation.
//
// - 10.1: a rerun with the same options produces no file-content or
//   project-configuration changes after repository-standard formatting.
// - 10.5: when a required CDK export already exists (here: because the
//   first run created it), the rerun preserves a single equivalent export
//   statement.
// - 10.11: only equivalent Generator-Owned Wiring is deduplicated — after
//   the rerun re-applies every wiring entry, each surface still holds
//   exactly one semantic copy.
//
// The Generator-Owned Wiring surfaces are fixed by the design: project
// configuration (project.json targets/metadata), root package.json
// dependency declarations, CDK star exports, the in-template Runtime
// Configuration registration, and the shared-infrastructure metric tag.
// Their expected shapes are restated literally below rather than imported
// from the implementation's constants.
// ---------------------------------------------------------------------------

const SHARED_CONSTRUCTS_ROOT = 'packages/common/constructs';
const SHARED_TERRAFORM_ROOT = 'packages/common/terraform';

const cdkConstructPath = (kebab: string): string =>
  `${SHARED_CONSTRUCTS_ROOT}/src/app/harnesses/${kebab}/${kebab}.ts`;
const CDK_HARNESSES_INDEX_PATH = `${SHARED_CONSTRUCTS_ROOT}/src/app/harnesses/index.ts`;
const CDK_APP_INDEX_PATH = `${SHARED_CONSTRUCTS_ROOT}/src/app/index.ts`;
const CDK_METRICS_ASPECT_PATH = `${SHARED_CONSTRUCTS_ROOT}/src/core/app.ts`;
const tfModulePath = (kebab: string): string =>
  `${SHARED_TERRAFORM_ROOT}/src/app/harnesses/${kebab}/${kebab}.tf`;
const TF_METRICS_PATH = `${SHARED_TERRAFORM_ROOT}/src/metrics/metrics.tf`;

/** The unique Harness metric tag registered for this generator (g68). */
const HARNESS_METRIC = AGENTCORE_HARNESS_GENERATOR_INFO.metric;

/** Runtime dependencies the generated Invocation Client imports. */
const RUNTIME_DEPENDENCIES = [
  '@aws-sdk/client-bedrock-agentcore',
  '@aws-sdk/client-appconfigdata',
  '@aws-lambda-powertools/parameters',
] as const;

/** Development dependencies required by the generated targets. */
const DEV_DEPENDENCIES = ['@types/node', 'tsx', 'typescript'] as const;

/**
 * Creation options persisted in Generator-owned project metadata. On a
 * compatible rerun the persisted value is authoritative when the option is
 * omitted, so omitting any subset of these previously-supplied options is
 * an "equivalent options" rerun.
 */
const PERSISTED_CREATION_OPTIONS = [
  'modelId',
  'systemPrompt',
  'allowedTools',
  'maxIterations',
  'maxTokens',
  'timeoutSeconds',
] as const;
type PersistedCreationOption = (typeof PERSISTED_CREATION_OPTIONS)[number];

// ---------------------------------------------------------------------------
// Canonical observations
// ---------------------------------------------------------------------------

interface CanonicalFile {
  path: string;
  type: string;
  content: string | undefined;
}

/**
 * Canonicalize the full tree state: every recorded change as
 * (path, type, content), sorted by path. The test workspace starts from an
 * empty in-memory backing filesystem, so the change set IS the full
 * generated tree, and equality of two snapshots means the second run
 * changed no file's bytes and neither created nor deleted any path.
 */
const canonicalTree = (tree: Tree): CanonicalFile[] =>
  tree
    .listChanges()
    .map((change) => ({
      path: change.path,
      type: change.type,
      content: change.content?.toString('utf-8'),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

/** The root package.json dependency sections (the dependency wiring). */
const dependencySections = (
  tree: Tree,
): { dependencies: unknown; devDependencies: unknown } => {
  const packageJson = readJson(tree, 'package.json');
  return {
    dependencies: packageJson.dependencies,
    devDependencies: packageJson.devDependencies,
  };
};

const countOccurrences = (content: string, needle: string): number =>
  content.split(needle).length - 1;

/**
 * Extract the CDK MetricsAspect tags array (restated from the shared
 * metrics test helper: `const tags: string[] = ['g1', 'g2']`).
 */
const cdkMetricTags = (content: string): string[] => {
  const tagsMatch = content.match(
    /const tags:\s*string\[\]\s*=\s*\[([^\]]*)\]/,
  );
  expect(tagsMatch).toBeTruthy();
  return tagsMatch![1].match(/'([^']*)'/g)?.map((t) => t.slice(1, -1)) ?? [];
};

/**
 * Extract the Terraform metrics tags array (restated from the shared
 * metrics test helper: `metric_tags = ["g1", "g2"]`).
 */
const terraformMetricTags = (content: string): string[] => {
  const tagsMatch = content.match(/metric_tags\s*=\s*\[([^\]]*)\]/);
  expect(tagsMatch).toBeTruthy();
  return tagsMatch![1].match(/"([^"]*)"/g)?.map((t) => t.slice(1, -1)) ?? [];
};

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const containsNonWhitespace = (value: string): boolean => /\S/.test(value);

/** The three infrastructure routes (CDK, Terraform, and `infra: none`). */
type Route = 'cdk' | 'terraform' | 'none';

/**
 * Valid human-readable names. Seeds cover the interesting normalization
 * shapes (spaces, camelCase humps, digit-leading words, accents, embedded
 * punctuation) and guarantee the name normalizes to a non-empty
 * identifier; decoration varies the rest.
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

/**
 * Custom model IDs and system prompts: free text with at least one
 * non-whitespace character, including quote/backslash/newline/Unicode
 * shapes so idempotence is shown across escaping-sensitive rendered
 * content, not just for the defaults.
 */
const arbCustomFreeText = fc.oneof(
  fc.string({ minLength: 1, maxLength: 40 }).filter(containsNonWhitespace),
  fc.constantFrom(
    'custom.model-id',
    'anthropic.claude-sonnet-4-5-20250929-v1:0',
    'Custom prompt with "quotes", \\backslashes\\ and\nnewlines.',
    'unicode tëxt ✓',
  ),
);

const arbToolEntry = fc.oneof(
  fc.constant('@builtin'),
  fc.string({ minLength: 1, maxLength: 16 }).filter(containsNonWhitespace),
);

/** Valid custom allowed-tool arrays (1 through 8 entries). */
const arbCustomAllowedTools = fc.array(arbToolEntry, {
  minLength: 1,
  maxLength: 8,
});

const arbCustomLimit = fc.integer({ min: 1, max: 2_000_000 });

/**
 * Deterministic valid placement fragments. Placement is repeated verbatim
 * on the rerun (it is identity, not persisted metadata), so a small set of
 * shapes — default, custom parent, nested sub-directory — exercises the
 * placement-sensitive wiring paths.
 */
const arbDirectory = fc.option(
  fc.constantFrom('packages', 'apps', 'libs/nested'),
  { nil: undefined },
);
const arbSubDirectory = fc.option(
  fc.constantFrom('harness-home', 'nested/leaf'),
  { nil: undefined },
);

interface IdempotencyCandidate {
  route: Route;
  name: string;
  directory: string | undefined;
  subDirectory: string | undefined;
  /**
   * For provider routes: whether `infra: 'agentcore'` is supplied
   * explicitly or omitted (both resolve to 'agentcore').
   */
  explicitInfra: boolean;
  /** For the `none` route: the accompanying (unused) `iac` value. */
  noneIac: IacOption | undefined;
  modelId: string | undefined;
  systemPrompt: string | undefined;
  allowedTools: string[] | undefined;
  maxIterations: number | undefined;
  maxTokens: number | undefined;
  timeoutSeconds: number | undefined;
  /**
   * The equivalent-options rerun shape: `identical` repeats the raw
   * options verbatim; `omit-persisted` drops a subset of the persisted
   * creation options so they resolve from Generator-owned metadata.
   */
  rerunShape:
    | { kind: 'identical' }
    | { kind: 'omit-persisted'; omit: PersistedCreationOption[] };
}

const arbRerunShape: fc.Arbitrary<IdempotencyCandidate['rerunShape']> =
  fc.oneof(
    fc.constant({ kind: 'identical' } as const),
    fc
      .uniqueArray(fc.constantFrom(...PERSISTED_CREATION_OPTIONS), {
        minLength: 1,
        maxLength: PERSISTED_CREATION_OPTIONS.length,
      })
      .map((omit) => ({ kind: 'omit-persisted', omit }) as const),
  );

const arbIdempotencyCandidate: fc.Arbitrary<IdempotencyCandidate> = fc.record({
  route: fc.constantFrom<Route>('cdk', 'terraform', 'none'),
  name: arbValidName,
  directory: arbDirectory,
  subDirectory: arbSubDirectory,
  explicitInfra: fc.boolean(),
  noneIac: fc.option(
    fc.constantFrom<IacOption>('inherit', 'cdk', 'terraform'),
    { nil: undefined },
  ),
  modelId: fc.option(arbCustomFreeText, { nil: undefined }),
  systemPrompt: fc.option(arbCustomFreeText, { nil: undefined }),
  allowedTools: fc.option(arbCustomAllowedTools, { nil: undefined }),
  maxIterations: fc.option(arbCustomLimit, { nil: undefined }),
  maxTokens: fc.option(arbCustomLimit, { nil: undefined }),
  timeoutSeconds: fc.option(arbCustomLimit, { nil: undefined }),
  rerunShape: arbRerunShape,
});

/** Map a candidate onto the public generator option contract (run 1). */
const firstRunOptions = (
  candidate: IdempotencyCandidate,
): AgentcoreHarnessGeneratorSchema => {
  const common: AgentcoreHarnessGeneratorSchema = {
    name: candidate.name,
    directory: candidate.directory,
    subDirectory: candidate.subDirectory,
    modelId: candidate.modelId,
    systemPrompt: candidate.systemPrompt,
    allowedTools: candidate.allowedTools,
    maxIterations: candidate.maxIterations,
    maxTokens: candidate.maxTokens,
    timeoutSeconds: candidate.timeoutSeconds,
  };
  switch (candidate.route) {
    case 'cdk':
    case 'terraform':
      // Provider routes keep `iac` explicit on every run: `iac` is not
      // persisted metadata, and `inherit` cannot resolve in a workspace
      // without a configured default provider.
      return {
        ...common,
        infra: candidate.explicitInfra ? 'agentcore' : undefined,
        iac: candidate.route,
      };
    case 'none':
      return { ...common, infra: 'none', iac: candidate.noneIac };
  }
};

/**
 * The equivalent-options rerun: identical raw options, or the same options
 * with a subset of the persisted creation options omitted (they resolve
 * from Generator-owned metadata). Arrays are copied so the second run
 * never aliases the first run's values.
 */
const secondRunOptions = (
  candidate: IdempotencyCandidate,
  run1: AgentcoreHarnessGeneratorSchema,
): AgentcoreHarnessGeneratorSchema => {
  const options: AgentcoreHarnessGeneratorSchema = {
    ...run1,
    allowedTools: run1.allowedTools ? [...run1.allowedTools] : undefined,
  };
  if (candidate.rerunShape.kind === 'omit-persisted') {
    for (const option of candidate.rerunShape.omit) {
      delete options[option];
    }
  }
  return options;
};

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('agentcore-harness Generator-Owned Wiring idempotency (Property 15)', () => {
  // Feature: agentcore-harness-generator, Property 15: Generator-Owned Wiring reruns are idempotent
  // **Validates: Requirements 10.1, 10.5, 10.11**
  it('reruns with equivalent options leave the canonical tree unchanged with one semantic copy of each wiring entry', async () => {
    await fc.assert(
      fc.asyncProperty(arbIdempotencyCandidate, async (candidate) => {
        // A fresh workspace per case: run 1 establishes the project, CDK
        // or Terraform infrastructure, Runtime Configuration registration,
        // exports, dependencies, and metrics that run 2 must not change.
        const tree = createTreeUsingTsSolutionSetup();
        const run1 = firstRunOptions(candidate);
        const resolved = resolveAgentcoreHarnessOptions(tree, run1);
        const kebab = resolved.nameKebabCase;
        const fqn = resolved.fullyQualifiedProjectName;

        await agentcoreHarnessGenerator(tree, run1);

        const treeAfterRun1 = canonicalTree(tree);
        const projectAfterRun1 = structuredClone(
          readProjectConfiguration(tree, fqn),
        );
        const dependenciesAfterRun1 = structuredClone(dependencySections(tree));

        await agentcoreHarnessGenerator(
          tree,
          secondRunOptions(candidate, run1),
        );

        // 10.1: no file-content changes after repository-standard
        // formatting — the canonical trees are identical, so no path was
        // created, deleted, or rewritten with different bytes.
        expect(canonicalTree(tree)).toEqual(treeAfterRun1);

        // 10.1: no project-configuration changes — the configuration read
        // back through the project API is deep-equal, and the Harness still
        // has exactly one project configuration (10.11).
        expect(readProjectConfiguration(tree, fqn)).toEqual(projectAfterRun1);
        expect(
          [...getProjects(tree).keys()].filter((name) => name === fqn),
        ).toHaveLength(1);

        // Dependency wiring: the merge added every required package once
        // (JSON keys are unique) and the rerun changed nothing.
        const dependencies = dependencySections(tree);
        expect(dependencies).toEqual(dependenciesAfterRun1);
        for (const dependency of RUNTIME_DEPENDENCIES) {
          expect(dependencies.dependencies).toHaveProperty([dependency]);
        }
        for (const dependency of DEV_DEPENDENCIES) {
          expect(dependencies.devDependencies).toHaveProperty([dependency]);
        }

        // One semantic copy of each provider wiring entry after the rerun
        // (10.5 for the CDK exports, 10.11 for every surface).
        switch (candidate.route) {
          case 'cdk': {
            // Exactly one star export per index (10.5): the rerun found
            // the existing export equivalent and preserved a single copy.
            expect(
              countOccurrences(
                tree.read(CDK_HARNESSES_INDEX_PATH, 'utf-8')!,
                `export * from './${kebab}/${kebab}.js'`,
              ),
            ).toBe(1);
            expect(
              countOccurrences(
                tree.read(CDK_APP_INDEX_PATH, 'utf-8')!,
                "export * from './harnesses/index.js'",
              ),
            ).toBe(1);

            // Exactly one Runtime Configuration registration in the
            // construct (the in-template wiring was not duplicated).
            expect(
              countOccurrences(
                tree.read(cdkConstructPath(kebab), 'utf-8')!,
                'rc.set(',
              ),
            ).toBe(1);

            // Exactly one Harness metric tag in the metrics aspect.
            expect(
              cdkMetricTags(
                tree.read(CDK_METRICS_ASPECT_PATH, 'utf-8')!,
              ).filter((tag) => tag === HARNESS_METRIC),
            ).toHaveLength(1);
            break;
          }
          case 'terraform': {
            // Exactly one Runtime Configuration entry module in the
            // Terraform module.
            expect(
              countOccurrences(
                tree.read(tfModulePath(kebab), 'utf-8')!,
                'module "add_harness_arn_to_runtime_config"',
              ),
            ).toBe(1);

            // Exactly one Harness metric tag in the Terraform metrics.
            expect(
              terraformMetricTags(tree.read(TF_METRICS_PATH, 'utf-8')!).filter(
                (tag) => tag === HARNESS_METRIC,
              ),
            ).toHaveLength(1);
            break;
          }
          case 'none': {
            // No provider wiring exists on either run: the tree equality
            // above is the whole contract, and no Shared Infrastructure
            // Project appeared.
            expect(tree.exists(SHARED_CONSTRUCTS_ROOT)).toBe(false);
            expect(tree.exists(SHARED_TERRAFORM_ROOT)).toBe(false);
            break;
          }
        }
      }),
      // At least 100 runs required; each case is two full generator runs,
      // so 100 keeps the heaviest suite property within its time budget.
      { numRuns: 100 },
    );
  }, 300_000);
});
