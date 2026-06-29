/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, updateProjectConfiguration } from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import {
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import type { TsDynamoDBMcpServerConnectionGeneratorSchema } from './schema';

export const TS_DYNAMODB_MCP_SERVER_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsDynamoDBMcpServerConnectionGenerator = async (
  tree: Tree,
  options: TsDynamoDBMcpServerConnectionGeneratorSchema,
): Promise<void> => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  const mcpServerName = options.sourceComponent?.name ?? 'mcp-server';
  const devTarget = `${mcpServerName}-dev`;

  if (sourceProject.targets?.[devTarget]) {
    addDependencyToTargetIfNotPresent(sourceProject, devTarget, {
      projects: [targetProject.name],
      target: 'dev',
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  await addGeneratorMetricsIfApplicable(tree, [
    TS_DYNAMODB_MCP_SERVER_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
};

export default tsDynamoDBMcpServerConnectionGenerator;
