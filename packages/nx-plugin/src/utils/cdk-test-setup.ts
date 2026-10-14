/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import { applyGritQL } from './ast.js';

/** Where the vitest global setup lives, relative to the project root. */
export const CDK_TEST_GLOBAL_SETUP = 'tests/global-setup.ts';

/** The `globalSetup` entry the vitest config registers. */
export const CDK_TEST_GLOBAL_SETUP_ENTRY = `./${CDK_TEST_GLOBAL_SETUP}`;

export const CDK_TEST_GLOBAL_SETUP_TEMPLATE_DIR = join(
  import.meta.dirname,
  'files',
  'cdk-test-setup',
);

/** The global setup exactly as it is vended (the template has no variables). */
export const renderCdkTestGlobalSetup = (): string =>
  readFileSync(
    join(
      CDK_TEST_GLOBAL_SETUP_TEMPLATE_DIR,
      `${CDK_TEST_GLOBAL_SETUP}.template`,
    ),
    'utf-8',
  );

/**
 * Register the global setup as the first property of the config's own `test`
 * object. Prepending means no trailing comma to manage, and the `not some`
 * guard leaves a config that already declares a global setup alone.
 */
export const GLOBAL_SETUP_PATTERN = `\`test: { $props }\` => \`test: { globalSetup: ['${CDK_TEST_GLOBAL_SETUP_ENTRY}'], $props }\` where {
  $props <: within \`defineConfig($_)\`,
  $props <: not some \`globalSetup: $_\`
}`;

/** The project's vitest config, if it has one. */
export const findVitestConfig = (
  tree: Tree,
  projectRoot: string,
): string | undefined =>
  [
    joinPathFragments(projectRoot, 'vitest.config.mts'),
    joinPathFragments(projectRoot, 'vite.config.mts'),
  ].find((config) => tree.exists(config));

/**
 * Give a CDK project's tests a per-run temp directory with asset bundling
 * skipped: vend `tests/global-setup.ts` (kept if it exists) and register it in
 * the vitest config. The caller formats.
 */
export const addCdkTestGlobalSetup = async (
  tree: Tree,
  projectRoot: string,
): Promise<void> => {
  generateFiles(
    tree,
    CDK_TEST_GLOBAL_SETUP_TEMPLATE_DIR,
    projectRoot,
    {},
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  const configPath = findVitestConfig(tree, projectRoot);
  if (configPath) {
    await applyGritQL(tree, configPath, GLOBAL_SETUP_PATTERN);
  }
};
