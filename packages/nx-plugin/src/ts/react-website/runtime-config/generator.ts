/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import { addSingleImport, applyGritQL, matchGritQL } from '../../../utils/ast';
import { addHookResultToRouterProviderContext } from '../../../utils/ast/website';
import { formatFilesInSubtree } from '../../../utils/format';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { getNpmScopePrefix } from '../../../utils/npm-scope';
import {
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { toProjectRelativePath } from '../../../utils/paths';
import type { RuntimeConfigGeneratorSchema } from './schema';

export const RUNTIME_CONFIG_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

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
    joinPathFragments(import.meta.dirname, 'files', 'app'),
    srcRoot,
    {
      ...options,
      npmScopePrefix,
      scopeAlias: npmScopePrefix,
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Only add RuntimeConfigProvider wrapper and import if not already present in JSX
  const alreadyWrapped = await matchGritQL(
    tree,
    mainTsxPath,
    '`<RuntimeConfigProvider>$_</RuntimeConfigProvider>`',
  );
  if (!alreadyWrapped) {
    await addSingleImport(
      tree,
      mainTsxPath,
      'RuntimeConfigProvider',
      './components/RuntimeConfig',
    );

    const wrapped = await applyGritQL(
      tree,
      mainTsxPath,
      '`<App />` => `<RuntimeConfigProvider><App /></RuntimeConfigProvider>`',
    );

    if (!wrapped) {
      throw new Error('Could not locate the App element in main.tsx');
    }
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
