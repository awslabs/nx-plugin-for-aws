/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import camelCase from 'lodash.camelcase';
import { formatFilesInSubtree } from '../../../utils/format';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { kebabCase, pascalCase } from '../../../utils/names';
import {
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import type { TsRdbTrpcConnectionGeneratorSchema } from './schema';

export const TS_RDB_TRPC_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

export const tsRdbTrpcConnectionGenerator = async (
  tree: Tree,
  options: TsRdbTrpcConnectionGeneratorSchema,
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

  const rdbBaseName = targetProject.name.split('/').pop();
  const rdbNameKebab = kebabCase(rdbBaseName);
  const rdbNameCamel = camelCase(rdbBaseName);
  const rdbNamePascal = pascalCase(rdbBaseName);
  const rdbPackageAlias = targetProject.name;
  const engine = ((targetProject.metadata as any) ?? {}).engine ?? 'PostgreSQL';

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files'),
    sourceProject.root,
    { rdbNameKebab, rdbNameCamel, rdbNamePascal, rdbPackageAlias, engine },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_RDB_TRPC_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
};

export default tsRdbTrpcConnectionGenerator;
