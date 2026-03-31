/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  generateFiles,
  Tree,
  OverwriteStrategy,
} from '@nx/devkit';
import { RuntimeConfigGeneratorSchema } from './schema';
import { factory } from 'typescript';
import { getNpmScopePrefix, toScopeAlias } from '../../../utils/npm-scope';
import { formatFilesInSubtree } from '../../../utils/format';
import { prependStatements, applyGritQLTransform } from '../../../utils/ast';
import {
  NxGeneratorInfo,
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { toProjectRelativePath } from '../../../utils/paths';
import { addHookResultToRouterProviderContext } from '../../../utils/ast/website';

export const RUNTIME_CONFIG_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function runtimeConfigGenerator(
  tree: Tree,
  options: RuntimeConfigGeneratorSchema,
) {
  const projectConfig = readProjectConfigurationUnqualified(
    tree,
    options.project,
  );
  const srcRoot = projectConfig.sourceRoot;
  const mainTsxPath = joinPathFragments(srcRoot, 'main.tsx');
  if (!tree.exists(mainTsxPath)) {
    throw new Error(
      `Can only run this generator on a project which contains ${mainTsxPath}`,
    );
  }

  const runtimeConfigPath = joinPathFragments(
    srcRoot,
    'components',
    'RuntimeConfig',
    'index.tsx',
  );
  if (tree.exists(runtimeConfigPath)) {
    console.debug('Runtime config already exists, skipping generation');
    return;
  }

  const npmScopePrefix = getNpmScopePrefix(tree);
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'app'),
    srcRoot,
    {
      ...options,
      npmScopePrefix,
      scopeAlias: toScopeAlias(npmScopePrefix),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
  const runtimeContextImport = factory.createImportDeclaration(
    undefined,
    factory.createImportClause(
      false,
      factory.createIdentifier('RuntimeConfigProvider'),
      undefined,
    ),
    factory.createStringLiteral('./components/RuntimeConfig', true),
  );
  prependStatements(tree, mainTsxPath, [runtimeContextImport]);

  const wrapped = await applyGritQLTransform(
    tree,
    mainTsxPath,
    '`<App />` => `<RuntimeConfigProvider><App /></RuntimeConfigProvider>`',
  );

  if (!wrapped) {
    throw new Error('Could not locate the App element in main.tsx');
  }

  await addHookResultToRouterProviderContext(tree, mainTsxPath, {
    hook: 'useRuntimeConfig',
    module: './hooks/useRuntimeConfig',
    contextProp: 'runtimeConfig',
  });

  addComponentGeneratorMetadata(
    tree,
    options.project,
    RUNTIME_CONFIG_GENERATOR_INFO,
    toProjectRelativePath(
      projectConfig,
      joinPathFragments(srcRoot, 'components', 'RuntimeConfig'),
    ),
  );

  await addGeneratorMetricsIfApplicable(tree, [RUNTIME_CONFIG_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
}
export default runtimeConfigGenerator;
