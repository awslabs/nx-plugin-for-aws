/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { GeneratorCallback, Tree } from '@nx/devkit';
import { declareDependencies } from '../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../utils/format.js';
import {
  GIT_SECRETS_DEPENDENCIES,
  setUpGitSecrets,
} from '../utils/git-secrets.js';
import { applyWorkspaceInit, INIT_DEPENDENCIES } from '../utils/init.js';
import { installDependencies } from '../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../utils/metrics.js';
import { getGeneratorInfo, type NxGeneratorInfo } from '../utils/nx.js';
import type { InitGeneratorSchema } from './schema';

// `husky` is owned here rather than by the preset: both mark the workspace by
// writing aws-nx-plugin.config.mts, and only init has an id there.
export const DEPENDENCIES = declareDependencies()({
  ts: [...GIT_SECRETS_DEPENDENCIES, ...INIT_DEPENDENCIES],
});

export const INIT_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

/**
 * Configure an existing Nx workspace to use the @aws/nx-plugin.
 *
 * Runs the same deterministic setup the workspace preset performs, so teams
 * with an established Nx workspace can adopt the plugin without recreating
 * their workspace. Every step is idempotent — re-running against an
 * already-initialised workspace is a safe no-op.
 */
export const initGenerator = async (
  tree: Tree,
  {
    iac,
    mcp,
    containers,
    gitSecrets,
    preferInstallDependencies,
  }: InitGeneratorSchema,
): Promise<GeneratorCallback> => {
  await applyWorkspaceInit(tree, { iac, containers, mcp }, DEPENDENCIES);

  if (gitSecrets !== false) {
    setUpGitSecrets(tree, DEPENDENCIES);
  }

  await addGeneratorMetricsIfApplicable(tree, [INIT_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default initGenerator;
