/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  joinPathFragments,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format';
import { installDependencies } from '../../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { toSnakeCase } from '../../../utils/names';
import {
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { addWorkspaceDependencyToPyProject } from '../../../utils/py';
import { injectRdsCaBundleIntoDockerfile } from '../utils';
import type { PyRdbMcpServerConnectionGeneratorSchema } from './schema';

export const PY_RDB_MCP_SERVER_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

export const pyRdbMcpServerConnectionGenerator = async (
  tree: Tree,
  options: PyRdbMcpServerConnectionGeneratorSchema,
): Promise<GeneratorCallback> => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  addWorkspaceDependencyToPyProject(tree, sourceProject, targetProject);

  const mcpServerName = options.sourceComponent?.name ?? 'mcp-server';
  const devTarget = `${mcpServerName}-dev`;
  const mcpServerSourceDir = options.sourceComponent?.path
    ? joinPathFragments(sourceProject.root, options.sourceComponent.path)
    : sourceProject.sourceRoot
      ? joinPathFragments(sourceProject.sourceRoot, toSnakeCase(mcpServerName))
      : undefined;
  const dockerfilePath = mcpServerSourceDir
    ? joinPathFragments(mcpServerSourceDir, 'Dockerfile')
    : undefined;

  if (dockerfilePath) {
    injectRdsCaBundleIntoDockerfile(tree, dockerfilePath);
  }

  if (sourceProject.targets?.[devTarget]) {
    addDependencyToTargetIfNotPresent(sourceProject, devTarget, {
      projects: [targetProject.name],
      target: 'dev',
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  await addGeneratorMetricsIfApplicable(tree, [
    PY_RDB_MCP_SERVER_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
};

export default pyRdbMcpServerConnectionGenerator;
