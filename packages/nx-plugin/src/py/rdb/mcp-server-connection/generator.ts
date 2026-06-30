/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  installPackagesTask,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import {
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { Logger, UVProvider } from '../../../utils/nxlv-python';
import { addWorkspaceDependencyToPyProject } from '../../../utils/py';
import type { PyRdbMcpServerConnectionGeneratorSchema } from './schema';

export const PY_RDB_MCP_SERVER_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

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
  const serveLocalTarget = `${mcpServerName}-serve-local`;

  if (sourceProject.targets?.[serveLocalTarget]) {
    addDependencyToTargetIfNotPresent(sourceProject, serveLocalTarget, {
      projects: [targetProject.name],
      target: 'serve-local',
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  await addGeneratorMetricsIfApplicable(tree, [
    PY_RDB_MCP_SERVER_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
  return async () => {
    installPackagesTask(tree);
    await new UVProvider(tree.root, new Logger(), tree).install();
  };
};

export default pyRdbMcpServerConnectionGenerator;
