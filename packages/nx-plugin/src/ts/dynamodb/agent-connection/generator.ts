/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, updateProjectConfiguration } from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics.js';
import {
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx.js';
import type { TsDynamoDBAgentConnectionGeneratorSchema } from './schema';

export const TS_DYNAMODB_AGENT_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

export const tsDynamoDBAgentConnectionGenerator = async (
  tree: Tree,
  options: TsDynamoDBAgentConnectionGeneratorSchema,
): Promise<void> => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  const agentName = options.sourceComponent?.name ?? 'agent';
  const devTarget = `${agentName}-dev`;

  if (sourceProject.targets?.[devTarget]) {
    addDependencyToTargetIfNotPresent(sourceProject, devTarget, {
      projects: [targetProject.name],
      target: 'dev',
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  // Recorded so the version sync can identify this connection.
  addComponentGeneratorMetadata(
    tree,
    sourceProject.name,
    TS_DYNAMODB_AGENT_CONNECTION_GENERATOR_INFO,
    targetProject.root,
    `${agentName}-${targetProject.name}`,
    // The source component this connection is made from, so the pair is
    // identifiable rather than just the two projects.
    { sourcePath: options.sourceComponent?.path },
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_DYNAMODB_AGENT_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
};

export default tsDynamoDBAgentConnectionGenerator;
