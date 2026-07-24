/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 5: Infrastructure routing is exclusive
 * Validates: Requirements 4.3, 4.4, 4.5
 *
 * For all valid resolved Generator options, CDK selection produces Harness
 * CDK output and no Harness Terraform output, Terraform selection produces
 * Harness Terraform output and no Harness CDK output, and `infra: none`
 * produces neither while still producing the Harness Project.
 *
 * Each generated case runs the full generator against a fresh empty
 * workspace so a starting-from-empty run can also observe that the
 * unselected provider's Shared Infrastructure Project is never created for
 * the Harness. Names, model IDs, system prompts, allowed tools, and
 * execution limits vary across the valid option space so exclusivity is
 * shown to be a routing invariant rather than a property of the defaults.
 *
 * Runtime note: each case is a complete generator run (template rendering
 * plus repository-standard formatting). Measured locally this stays well
 * within the suite's per-test budget at 120 runs, so real formatting is
 * kept rather than mocked; routing assertions therefore observe exactly
 * what a real run writes.
 */
import { joinPathFragments, readProjectConfiguration } from '@nx/devkit';
import fc from 'fast-check';
import type { IacOption } from '../utils/iac';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { agentcoreHarnessGenerator } from './generator';
import { resolveAgentcoreHarnessOptions } from './resolve-options';
import type { AgentcoreHarnessGeneratorSchema } from './schema';

// ---------------------------------------------------------------------------
// Model: the routing contract from the requirements, restated independently
// of the generator implementation.
//
// - 4.3: resolved provider `cdk` emits CDK Harness infrastructure and omits
//   Terraform Harness infrastructure.
// - 4.4: resolved provider `terraform` emits Terraform Harness
//   infrastructure and omits CDK Harness infrastructure.
// - 4.5: `infra: none` emits the Harness Project without emitting or
//   modifying a Shared Infrastructure Project for the Harness.
//
// The Harness infrastructure surfaces are fixed by requirements 5.1 and
// 6.1, so the expected paths are restated here literally rather than
// imported from the implementation's path constants:
// - CDK construct:
//   packages/common/constructs/src/app/harnesses/<kebab>/<kebab>.ts
// - Terraform module:
//   packages/common/terraform/src/app/harnesses/<kebab>/<kebab>.tf
// All Harness infrastructure lives under one of the two Shared
// Infrastructure Project roots, so "no Harness <provider> output" is
// modeled as "no file was created under that provider's root".
// ---------------------------------------------------------------------------

const SHARED_CONSTRUCTS_ROOT = 'packages/common/constructs';
const SHARED_TERRAFORM_ROOT = 'packages/common/terraform';

const cdkConstructPath = (kebab: string): string =>
  `${SHARED_CONSTRUCTS_ROOT}/src/app/harnesses/${kebab}/${kebab}.ts`;
const CDK_HARNESSES_INDEX_PATH = `${SHARED_CONSTRUCTS_ROOT}/src/app/harnesses/index.ts`;
const CDK_APP_INDEX_PATH = `${SHARED_CONSTRUCTS_ROOT}/src/app/index.ts`;
const tfModulePath = (kebab: string): string =>
  `${SHARED_TERRAFORM_ROOT}/src/app/harnesses/${kebab}/${kebab}.tf`;

/** The three routing outcomes named by requirements 4.3, 4.4, and 4.5. */
type Route = 'cdk' | 'terraform' | 'none';

interface RoutingCandidate {
  route: Route;
  name: string;
  /**
   * For provider routes: whether `infra: 'agentcore'` is supplied
   * explicitly or omitted (it resolves to 'agentcore' either way, so both
   * spellings must route identically).
   */
  explicitInfra: boolean;
  /**
   * For the `none` route: the accompanying `iac` value. Even an explicit
   * provider selection must produce no Harness infrastructure when
   * `infra` is `none` (4.5), so every valid `iac` value is exercised.
   */
  noneIac: IacOption | undefined;
  modelId: string | undefined;
  systemPrompt: string | undefined;
  allowedTools: string[] | undefined;
  maxIterations: number | undefined;
  maxTokens: number | undefined;
  timeoutSeconds: number | undefined;
}

/** Map a candidate onto the public generator option contract. */
const optionsForCandidate = (
  candidate: RoutingCandidate,
): AgentcoreHarnessGeneratorSchema => {
  const common: AgentcoreHarnessGeneratorSchema = {
    name: candidate.name,
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
      return {
        ...common,
        infra: candidate.explicitInfra ? 'agentcore' : undefined,
        iac: candidate.route,
      };
    case 'none':
      return { ...common, infra: 'none', iac: candidate.noneIac };
  }
};

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const containsNonWhitespace = (value: string): boolean => /\S/.test(value);

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
 * shapes. Values are JSON-encoded by the template context, so these vary
 * the rendered output without turning this property into the
 * template-escaping property (Property 4).
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

const arbRoutingCandidate: fc.Arbitrary<RoutingCandidate> = fc.record({
  route: fc.constantFrom<Route>('cdk', 'terraform', 'none'),
  name: arbValidName,
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
});

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('agentcore-harness infrastructure routing (Property 5)', () => {
  // Feature: agentcore-harness-generator, Property 5: Infrastructure routing is exclusive
  // **Validates: Requirements 4.3, 4.4, 4.5**
  it('emits exactly the selected provider surface across the valid option space', async () => {
    await fc.assert(
      fc.asyncProperty(arbRoutingCandidate, async (candidate) => {
        // A fresh empty workspace per case: routing writes shared
        // infrastructure, so reusing a tree would let one case's provider
        // output mask another case's routing violation.
        const tree = createTreeUsingTsSolutionSetup();
        const options = optionsForCandidate(candidate);
        const resolved = resolveAgentcoreHarnessOptions(tree, options);
        const kebab = resolved.nameKebabCase;

        await agentcoreHarnessGenerator(tree, options);

        // In all cases the standalone Harness Project exists (4.5's
        // "while still producing the Harness Project" holds on every
        // route, since provider selection must not affect the project).
        const project = readProjectConfiguration(
          tree,
          resolved.fullyQualifiedProjectName,
        );
        expect(project.root).toBe(resolved.projectRoot);
        for (const file of [
          'project.json',
          'invoke.ts',
          'README.md',
          'tsconfig.json',
        ]) {
          expect(
            tree.exists(joinPathFragments(resolved.projectRoot, file)),
          ).toBe(true);
        }

        // Every path created by this run under either Shared
        // Infrastructure Project root. Harness infrastructure lives only
        // under these roots (5.1, 6.1), so the unselected provider's set
        // must be empty.
        const createdSharedPaths = tree
          .listChanges()
          .filter((change) => change.type !== 'DELETE')
          .map((change) => change.path);
        const constructsPaths = createdSharedPaths.filter((path) =>
          path.startsWith(`${SHARED_CONSTRUCTS_ROOT}/`),
        );
        const terraformPaths = createdSharedPaths.filter((path) =>
          path.startsWith(`${SHARED_TERRAFORM_ROOT}/`),
        );

        switch (candidate.route) {
          case 'cdk': {
            // CDK Harness output is present: the construct at the exact
            // required path, exported through the harnesses app index and
            // the shared app index (4.3).
            expect(tree.exists(cdkConstructPath(kebab))).toBe(true);
            expect(tree.read(CDK_HARNESSES_INDEX_PATH, 'utf-8')).toContain(
              `export * from './${kebab}/${kebab}.js'`,
            );
            expect(tree.read(CDK_APP_INDEX_PATH, 'utf-8')).toContain(
              "export * from './harnesses/index.js'",
            );

            // No Terraform Harness output: no module file, and starting
            // from empty no Terraform Shared Infrastructure Project was
            // created at all (4.3 exclusivity).
            expect(tree.exists(tfModulePath(kebab))).toBe(false);
            expect(tree.exists(SHARED_TERRAFORM_ROOT)).toBe(false);
            expect(terraformPaths).toEqual([]);
            break;
          }
          case 'terraform': {
            // Terraform Harness output is present at the exact required
            // path (4.4).
            expect(tree.exists(tfModulePath(kebab))).toBe(true);

            // No CDK Harness output: no construct, no CDK index exports,
            // and starting from empty no CDK Shared Infrastructure
            // Project was created at all (4.4 exclusivity).
            expect(tree.exists(cdkConstructPath(kebab))).toBe(false);
            expect(tree.exists(CDK_HARNESSES_INDEX_PATH)).toBe(false);
            expect(tree.exists(SHARED_CONSTRUCTS_ROOT)).toBe(false);
            expect(constructsPaths).toEqual([]);
            break;
          }
          case 'none': {
            // Neither provider's Harness infrastructure nor Shared
            // Infrastructure Project exists, regardless of the `iac`
            // value supplied alongside `infra: none` (4.5).
            expect(tree.exists(cdkConstructPath(kebab))).toBe(false);
            expect(tree.exists(tfModulePath(kebab))).toBe(false);
            expect(tree.exists(SHARED_CONSTRUCTS_ROOT)).toBe(false);
            expect(tree.exists(SHARED_TERRAFORM_ROOT)).toBe(false);
            expect(constructsPaths).toEqual([]);
            expect(terraformPaths).toEqual([]);
            break;
          }
        }
      }),
      // At least 100 runs required; 120 gives roughly 40 full generator
      // runs per route while keeping suite runtime reasonable.
      { numRuns: 120 },
    );
  });
});
