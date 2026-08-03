/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format';
import { installDependencies } from '../../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import {
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { addWorkspaceDependencyToPyProject } from '../../../utils/py';
import type { PyDynamoDBFastApiConnectionGeneratorSchema } from './schema';

export const PY_DYNAMODB_FAST_API_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

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

  // Recorded so the version sync can identify this connection.
  addComponentGeneratorMetadata(
    tree,
    sourceProject.name,
    PY_DYNAMODB_FAST_API_CONNECTION_GENERATOR_INFO,
    targetProject.root,
    targetProject.name,
  );

  await addGeneratorMetricsIfApplicable(tree, [
    PY_DYNAMODB_FAST_API_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
};

export default pyDynamoDBFastApiConnectionGenerator;
