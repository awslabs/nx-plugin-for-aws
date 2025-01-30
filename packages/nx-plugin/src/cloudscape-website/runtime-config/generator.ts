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
import { tsquery, ast } from '@phenomnomnominal/tsquery';
import { factory, JsxElement, SourceFile } from 'typescript';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { getNpmScopePrefix, toScopeAlias } from '../../utils/npm-scope';
import { formatFilesInSubtree } from '../../utils/format';
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
  const mainTsxContents = tree.read(mainTsxPath).toString();
  const mainTsxAst = ast(mainTsxContents);
  const runtimeConfigPath = joinPathFragments(
    srcRoot,
    'components',
    'RuntimeConfig',
    'index.tsx',
  );
  if (
    tree.exists(runtimeConfigPath) ||
    tsquery.query(
      mainTsxAst,
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
  const updatedImports = tsquery
    .map(mainTsxAst, 'SourceFile', (node: SourceFile) => {
      return {
        ...node,
        statements: [runtimeContextImport, ...node.statements],
      };
    })
    .getFullText();
  let locatedTargetNode = false;
  const mainTsxUpdatedContents = tsquery
    .map(ast(updatedImports), 'JsxElement', (node: JsxElement) => {
      if (node.openingElement.tagName.getText() !== 'BrowserRouter') {
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
    })
    .getFullText();
  if (!locatedTargetNode) {
    throw new Error('Could not locate the BrowserRouter element in main.tsx');
  }
  if (locatedTargetNode && mainTsxContents !== mainTsxUpdatedContents) {
    tree.write(mainTsxPath, mainTsxUpdatedContents);
  }
  await formatFilesInSubtree(tree);
}
export default runtimeConfigGenerator;
