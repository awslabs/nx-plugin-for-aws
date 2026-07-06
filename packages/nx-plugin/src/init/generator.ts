/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type GeneratorCallback, type Tree } from '@nx/devkit';
import { formatFilesInSubtree } from '../utils/format';
import { applyWorkspaceInit } from '../utils/init';
import { installDependencies } from '../utils/install';
import { addGeneratorMetricsIfApplicable } from '../utils/metrics';
import { getGeneratorInfo, type NxGeneratorInfo } from '../utils/nx';
import type { InitGeneratorSchema } from './schema';

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
  { iac, mcp, containers, preferInstallDependencies }: InitGeneratorSchema,
): Promise<GeneratorCallback> => {
  await applyWorkspaceInit(tree, { iac, containers, mcp });

  await addGeneratorMetricsIfApplicable(tree, [INIT_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default initGenerator;
