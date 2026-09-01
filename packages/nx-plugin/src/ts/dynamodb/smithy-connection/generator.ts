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
import type { TsDynamoDBSmithyConnectionGeneratorSchema } from './schema';

export const TS_DYNAMODB_SMITHY_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

export const tsDynamoDBSmithyConnectionGenerator = async (
  tree: Tree,
  options: TsDynamoDBSmithyConnectionGeneratorSchema,
): Promise<void> => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  if (sourceProject.targets?.['dev']) {
    addDependencyToTargetIfNotPresent(sourceProject, 'dev', {
      projects: [targetProject.name],
      target: 'dev',
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  // Recorded so the version sync can identify this connection.
  addComponentGeneratorMetadata(
    tree,
    sourceProject.name,
    TS_DYNAMODB_SMITHY_CONNECTION_GENERATOR_INFO,
    targetProject.root,
    targetProject.name,
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_DYNAMODB_SMITHY_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
};

export default tsDynamoDBSmithyConnectionGenerator;
