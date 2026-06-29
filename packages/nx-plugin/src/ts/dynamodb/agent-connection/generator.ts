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

  await addGeneratorMetricsIfApplicable(tree, [
    TS_DYNAMODB_AGENT_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
};

export default tsDynamoDBAgentConnectionGenerator;
