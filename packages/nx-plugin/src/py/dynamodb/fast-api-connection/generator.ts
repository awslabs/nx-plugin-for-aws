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
import type { PyDynamoDBFastApiConnectionGeneratorSchema } from './schema';

export const PY_DYNAMODB_FAST_API_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const pyDynamoDBFastApiConnectionGenerator = async (
  tree: Tree,
  options: PyDynamoDBFastApiConnectionGeneratorSchema,
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

  if (sourceProject.targets?.['dev']) {
    addDependencyToTargetIfNotPresent(sourceProject, 'dev', {
      projects: [targetProject.name],
      target: 'dev',
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  await addGeneratorMetricsIfApplicable(tree, [
    PY_DYNAMODB_FAST_API_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
  return async () => {
    installPackagesTask(tree);
    await new UVProvider(tree.root, new Logger(), tree).install();
  };
};

export default pyDynamoDBFastApiConnectionGenerator;
