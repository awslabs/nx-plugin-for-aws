/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type ProjectConfiguration,
  type TargetConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { INFRA_APP_GENERATOR_INFO } from '../../../infra/app/generator.js';
import { matchGritQL } from '../../../utils/ast.js';
import {
  addCdkTestGlobalSetup,
  CDK_TEST_GLOBAL_SETUP,
  CDK_TEST_GLOBAL_SETUP_ENTRY,
  findVitestConfig,
  renderCdkTestGlobalSetup,
} from '../../../utils/cdk-test-setup.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { sortObjectKeys } from '../../../utils/object.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * Run CDK infrastructure tests against the artifacts their stacks deploy, in a
 * per-run temp directory with CDK asset bundling skipped.
 *
 * The infra `test` target inherited the `^build` target default, so every
 * infra test run first ran every deployed project's lint, test, type-check and
 * bundle. The stacks only need the bundles: `Code.fromAsset` and its siblings
 * throw on a missing asset path, so the edge is narrowed to `^assemble` (the
 * artifact-only chain `synth` and `deploy` already use) rather than removed.
 *
 * Each `new App()` in a test synthesizes into a fresh `cdk.out*` directory
 * under the OS temp dir, which nothing removed, so a workspace's tests leaked
 * into the shared `/tmp`. The vended `tests/global-setup.ts` points `TMPDIR`,
 * `TEMP` and `TMP` at a directory of its own for the run and removes it in
 * teardown. It also merges `aws:cdk:bundling-stacks: []` into
 * `CDK_CONTEXT_JSON`, which only affects user-written bundling constructs
 * (`NodejsFunction`, `PythonFunction`); the vended constructs read prebuilt
 * bundles. The setup is registered in the infra project's and the shared
 * constructs' vitest configs.
 *
 * Only the exact shape the generator wrote before is changed. A `test` target,
 * a `globalSetup`, a vitest config or a `tests/global-setup.ts` that differs is
 * left untouched and reported, and a setup file the plugin did not write is
 * never registered. The template has no comments, so a migrated project is
 * byte-identical to a freshly generated one. Infra READMEs are left alone: the
 * generator writes them `KeepExisting`, and users edit them.
 */

const TEST_TARGET = 'test';
const TEST_DEPENDS_ON = ['^assemble'];

const isFixedTestTarget = (target: TargetConfiguration): boolean =>
  Object.keys(target).length === 1 &&
  Array.isArray(target.dependsOn) &&
  target.dependsOn.length === TEST_DEPENDS_ON.length &&
  target.dependsOn.every((dep, index) => dep === TEST_DEPENDS_ON[index]);

/** Any `globalSetup` property in the config. */
const ANY_GLOBAL_SETUP = '`globalSetup: $_`';

/** Exactly the entry the generator registers. */
const VENDED_GLOBAL_SETUP = `\`globalSetup: ['${CDK_TEST_GLOBAL_SETUP_ENTRY}']\``;

/** The `defineConfig(() => ({ test: { ... } }))` shape the generator inserts into. */
const RECOGNISED_CONFIG = `\`test: { $props }\` where { $props <: within \`defineConfig($_)\` }`;

/**
 * Vend and register the global setup for one project, unless any of its files
 * has diverged from the generated shape. Returns the reason it was skipped.
 */
const migrateGlobalSetup = async (
  tree: Tree,
  projectName: string,
  root: string,
): Promise<string | undefined> => {
  const setupPath = joinPathFragments(root, CDK_TEST_GLOBAL_SETUP);
  const configPath = findVitestConfig(tree, root);

  if (!configPath) {
    return `${projectName}: no vitest config found in ${root} - add \`globalSetup: ['${CDK_TEST_GLOBAL_SETUP_ENTRY}']\` to its \`test\` options to give each test run its own temp directory.`;
  }

  if (
    tree.exists(setupPath) &&
    (tree.read(setupPath, 'utf-8') ?? '') !== renderCdkTestGlobalSetup()
  ) {
    return `${projectName}: ${setupPath} differs from the vended global setup - left untouched and not registered. Compare it with a freshly generated one, which gives each test run its own temp directory and skips CDK asset bundling, then add \`globalSetup: ['${CDK_TEST_GLOBAL_SETUP_ENTRY}']\` to ${configPath}.`;
  }

  if (await matchGritQL(tree, configPath, ANY_GLOBAL_SETUP)) {
    if (await matchGritQL(tree, configPath, VENDED_GLOBAL_SETUP)) {
      await addCdkTestGlobalSetup(tree, root);
      return undefined;
    }
    return `${projectName}: ${configPath} already declares a \`globalSetup\` - left untouched. Add '${CDK_TEST_GLOBAL_SETUP_ENTRY}' to it to give each test run its own temp directory.`;
  }

  if (!(await matchGritQL(tree, configPath, RECOGNISED_CONFIG))) {
    return `${projectName}: ${configPath} has diverged from the generated shape - left untouched. Add \`globalSetup: ['${CDK_TEST_GLOBAL_SETUP_ENTRY}']\` to its \`test\` options to give each test run its own temp directory.`;
  }

  await addCdkTestGlobalSetup(tree, root);
  return undefined;
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    const generator = (project.metadata as { generator?: string } | undefined)
      ?.generator;
    if (generator !== INFRA_APP_GENERATOR_INFO.id) continue;

    const testTarget = project.targets?.[TEST_TARGET];
    if (!testTarget) {
      updateProjectConfiguration(tree, projectName, {
        ...project,
        targets: sortObjectKeys({
          ...project.targets,
          [TEST_TARGET]: { dependsOn: [...TEST_DEPENDS_ON] },
        }),
      } as ProjectConfiguration);
    } else if (!isFixedTestTarget(testTarget)) {
      nextSteps.push(
        `${projectName}: the \`test\` target in ${joinPathFragments(project.root, 'project.json')} has diverged from the generated shape - left untouched. Set its \`dependsOn\` to ["^assemble"] so tests build the deployed projects' artifacts rather than every upstream build.`,
      );
    }

    const skipped = await migrateGlobalSetup(tree, projectName, project.root);
    if (skipped) nextSteps.push(skipped);
  }

  const constructsRoot = joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR);
  if (tree.exists(joinPathFragments(constructsRoot, 'project.json'))) {
    const skipped = await migrateGlobalSetup(
      tree,
      constructsRoot,
      constructsRoot,
    );
    if (skipped) nextSteps.push(skipped);
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
