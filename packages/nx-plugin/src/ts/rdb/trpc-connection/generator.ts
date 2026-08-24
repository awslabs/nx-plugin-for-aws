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
import { formatFilesInSubtree } from '../../../utils/format.js';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics.js';
import { kebabCase, pascalCase } from '../../../utils/names.js';
import {
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx.js';
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

  // Recorded so the version sync can identify this connection.
  addComponentGeneratorMetadata(
    tree,
    sourceProject.name,
    TS_RDB_TRPC_CONNECTION_GENERATOR_INFO,
    joinPathFragments('src', 'middleware', `${rdbNameKebab}.ts`),
    rdbNameCamel,
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_RDB_TRPC_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
};

export default tsRdbTrpcConnectionGenerator;
