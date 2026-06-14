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
import { addWorkspaceDependencyToPyProject } from '../../../utils/py';
import type { PyDynamoDBFastApiConnectionGeneratorSchema } from './schema';

export const PY_DYNAMODB_FAST_API_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const pyDynamoDBFastApiConnectionGenerator = async (
  tree: Tree,
  options: PyDynamoDBFastApiConnectionGeneratorSchema,
): Promise<void> => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  addWorkspaceDependencyToPyProject(
    tree,
    sourceProject.root,
    targetProject.name!,
  );

  if (sourceProject.targets?.['serve-local']) {
    addDependencyToTargetIfNotPresent(sourceProject, 'serve-local', {
      projects: [targetProject.name],
      target: 'serve-local',
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  await addGeneratorMetricsIfApplicable(tree, [
    PY_DYNAMODB_FAST_API_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
};

export default pyDynamoDBFastApiConnectionGenerator;
