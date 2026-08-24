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
import { formatFilesInSubtree } from '../../../utils/format.js';
import { installDependencies } from '../../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics.js';
import { toClassName, toSnakeCase } from '../../../utils/names.js';
import { getNpmScope } from '../../../utils/npm-scope.js';
import {
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx.js';
import { addWorkspaceDependencyToPyProject } from '../../../utils/py.js';
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
  const rdbNameSnake = toSnakeCase(rdbLocalName);
  const rdbNameClassName = toClassName(rdbLocalName);
  const apiName = (sourceProject.metadata as any)?.apiName as string;
  const apiModuleName = toSnakeCase(`${scope}_${toSnakeCase(apiName)}`);

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files'),
    sourceProject.root,
    { databasePackageAlias, rdbNameSnake, rdbNameClassName, apiModuleName },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Recorded so the version sync can identify this connection.
  addComponentGeneratorMetadata(
    tree,
    sourceProject.name,
    PY_RDB_FAST_API_CONNECTION_GENERATOR_INFO,
    joinPathFragments(apiModuleName, 'dependencies', `${rdbNameSnake}.py`),
    rdbNameSnake,
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
