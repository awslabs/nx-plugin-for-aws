/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format';
import { installDependencies } from '../../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { kebabCase, toSnakeCase } from '../../../utils/names';
import { getNpmScope } from '../../../utils/npm-scope';
import {
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { addWorkspaceDependencyToPyProject } from '../../../utils/py';
import type { PyRdbFastApiConnectionGeneratorSchema } from './schema';

export const PY_RDB_FAST_API_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

export const pyRdbFastApiConnectionGenerator = async (
  tree: Tree,
  options: PyRdbFastApiConnectionGeneratorSchema,
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

  const scope = toSnakeCase(getNpmScope(tree));
  const rdbLocalName = targetProject.name.split('.').pop()!;
  const databasePackageAlias = `${scope}_${rdbLocalName}`;
  const rdbNameKebab = kebabCase(rdbLocalName);
  const apiName = (sourceProject.metadata as any)?.apiName as string;
  const apiModuleName = toSnakeCase(`${scope}_${toSnakeCase(apiName)}`);

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files'),
    sourceProject.root,
    { databasePackageAlias, rdbNameKebab, apiModuleName },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  await addGeneratorMetricsIfApplicable(tree, [
    PY_RDB_FAST_API_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
};

export default pyRdbFastApiConnectionGenerator;
