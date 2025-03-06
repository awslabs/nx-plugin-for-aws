/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  generateFiles,
  Tree,
  readProjectConfiguration,
  OverwriteStrategy,
} from '@nx/devkit';
import { RuntimeConfigGeneratorSchema } from './schema';
import { factory, JsxSelfClosingElement } from 'typescript';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { getNpmScopePrefix, toScopeAlias } from '../../utils/npm-scope';
import { formatFilesInSubtree } from '../../utils/format';
import { prependStatements, query, replaceIfExists } from '../../utils/ast';

export async function runtimeConfigGenerator(
  tree: Tree,
  options: RuntimeConfigGeneratorSchema,
) {
  const srcRoot = readProjectConfiguration(tree, options.project).sourceRoot;
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
      if (node.tagName.getText() !== 'RouterProvider') {
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
    throw new Error('Could not locate the RouterProvider element in main.tsx');
  }

  await formatFilesInSubtree(tree);
}
export default runtimeConfigGenerator;
