/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { getNpmScope } from '../../../utils/npm-scope';
import {
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { Logger, UVProvider } from '../../../utils/nxlv-python';
import { addWorkspaceDependencyToPyProject } from '../../../utils/py';
import { kebabCase, toSnakeCase } from '../../../utils/names';
import type { PyRdbFastApiConnectionGeneratorSchema } from './schema';

export const PY_RDB_FAST_API_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

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

  addWorkspaceDependencyToPyProject(tree, sourceProject, targetProject
  );

  if (sourceProject.targets?.['serve-local']) {
    addDependencyToTargetIfNotPresent(sourceProject, 'serve-local', {
      projects: [targetProject.name],
      target: 'serve-local',
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
    joinPathFragments(__dirname, 'files'),
    sourceProject.root,
    { databasePackageAlias, rdbNameKebab, apiModuleName },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  await addGeneratorMetricsIfApplicable(tree, [
    PY_RDB_FAST_API_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
  return async () => {
    installPackagesTask(tree);
    await new UVProvider(tree.root, new Logger(), tree).install();
  };
};

export default pyRdbFastApiConnectionGenerator;
