/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, updateProjectConfiguration } from '@nx/devkit';
import { TsRdbStrandsAgentConnectionGeneratorSchema } from './schema';
import {
  NxGeneratorInfo,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';

export const TS_RDB_STRANDS_AGENT_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsRdbStrandsAgentConnectionGenerator = async (
  tree: Tree,
  options: TsRdbStrandsAgentConnectionGeneratorSchema,
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
  const serveLocalTarget = `${agentName}-serve-local`;

  if (sourceProject.targets?.[serveLocalTarget]) {
    addDependencyToTargetIfNotPresent(sourceProject, serveLocalTarget, {
      projects: [targetProject.name],
      target: 'serve-local',
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  await addGeneratorMetricsIfApplicable(tree, [
    TS_RDB_STRANDS_AGENT_CONNECTION_GENERATOR_INFO,
  ]);
};

export default tsRdbStrandsAgentConnectionGenerator;
