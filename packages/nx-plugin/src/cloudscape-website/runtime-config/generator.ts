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
import {
  factory,
  JsxSelfClosingElement,
  SyntaxKind,
  NodeFlags,
} from 'typescript';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { getNpmScopePrefix, toScopeAlias } from '../../utils/npm-scope';
import { formatFilesInSubtree } from '../../utils/format';
import {
  prependStatements,
  query,
  replaceIfExists,
  replace,
  addDestructuredImport,
} from '../../utils/ast';
import {
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { addHookResultToRouterProviderContext } from '../../utils/ast/website';

export const RUNTIME_CONFIG_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function runtimeConfigGenerator(
  tree: Tree,
  options: RuntimeConfigGeneratorSchema,
) {
  const srcRoot = readProjectConfigurationUnqualified(
    tree,
    options.project,
  ).sourceRoot;
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
  if (
    tree.exists(runtimeConfigPath) ||
    query(
      tree,
      mainTsxPath,
      'JsxElement > JsxOpeningElement[name.text="RuntimeConfigProvider"]',
    ).length > 0
  ) {
    console.debug('Runtime config already exists, skipping generation');
    return;
  }

  await sharedConstructsGenerator(tree);

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

  let locatedTargetNode = false;
  replaceIfExists(
    tree,
    mainTsxPath,
    'JsxSelfClosingElement',
    (node: JsxSelfClosingElement) => {
      if (node.tagName.getText() !== 'App') {
        return node;
      } else {
        locatedTargetNode = true;
      }
      return factory.createJsxElement(
        factory.createJsxOpeningElement(
          factory.createIdentifier('RuntimeConfigProvider'),
          undefined,
          factory.createJsxAttributes([]),
        ),
        [node],
        factory.createJsxClosingElement(
          factory.createIdentifier('RuntimeConfigProvider'),
        ),
      );
    },
  );

  if (!locatedTargetNode) {
    throw new Error('Could not locate the App element in main.tsx');
  }

  addHookResultToRouterProviderContext(tree, mainTsxPath, {
    hook: 'useRuntimeConfig',
    module: './hooks/useRuntimeConfig',
    contextProp: 'runtimeConfig',
  });

  await addGeneratorMetricsIfApplicable(tree, [RUNTIME_CONFIG_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
}
export default runtimeConfigGenerator;
