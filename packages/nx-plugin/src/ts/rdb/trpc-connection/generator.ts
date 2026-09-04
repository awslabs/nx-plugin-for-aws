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
import {
  addDestructuredImport,
  applyGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
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

  // Widen the root context so procedures composed with the plugin typecheck.
  const initPath = joinPathFragments(sourceProject.root, 'src', 'init.ts');
  const contextInterface = `I${rdbNamePascal}Context`;
  if (tree.exists(initPath)) {
    await applyGritQL(
      tree,
      initPath,
      `\`export type Context = $ctx;\` => \`export type Context = $ctx & ${contextInterface};\` where { $ctx <: not contains \`${contextInterface}\` }`,
    );

    const contextIncludesDb = await matchGritQL(
      tree,
      initPath,
      `\`export type Context = $ctx;\` where { $ctx <: contains \`${contextInterface}\` }`,
    );
    if (contextIncludesDb) {
      await addDestructuredImport(
        tree,
        initPath,
        [contextInterface],
        `./middleware/${rdbNameKebab}.js`,
      );
    }
  }

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
