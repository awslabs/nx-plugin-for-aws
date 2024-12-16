/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  generateFiles,
  Tree,
  readProjectConfiguration,
  addDependenciesToPackageJson,
  installPackagesTask,
} from '@nx/devkit';
import { CognitoAuthGeneratorSchema as CognitoAuthGeneratorSchema } from './schema';
import { runtimeConfigGenerator } from '../runtime-config/generator';
import { tsquery, ast } from '@phenomnomnominal/tsquery';
import { factory, ImportClause, JsxElement, SourceFile } from 'typescript';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs';
import { withVersions } from '../../utils/versions';
import { formatFilesInSubtree } from '../../utils/format';

export async function cognitoAuthGenerator(
  tree: Tree,
  options: CognitoAuthGeneratorSchema
) {
  const srcRoot = readProjectConfiguration(tree, options.project).sourceRoot;

  if (
    tree.exists(joinPathFragments(srcRoot, 'components/CognitoAuth/index.tsx'))
  ) {
    throw new Error(
      `This generator has already been run on ${options.project}.`
    );
  }

  await runtimeConfigGenerator(tree, {
    project: options.project,
  });

  await sharedConstructsGenerator(tree);
  const identityPath = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
    'identity',
    'index.ts'
  );

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'app'),
    srcRoot,
    options
  );

  if (!tree.exists(identityPath)) {
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', SHARED_CONSTRUCTS_DIR),
      joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR),
      {
        allowSignup: options.allowSignup,
      }
    );

    addDependenciesToPackageJson(
      tree,
      withVersions([
        'constructs',
        'aws-cdk-lib',
        '@aws/pdk',
        '@aws-cdk/aws-cognito-identitypool-alpha',
      ]),
      {}
    );

    const sharedConstructsIndexTsPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'index.ts'
    );
    const sharedConstructsIndexContents = tree
      .read(sharedConstructsIndexTsPath)
      .toString();

    const identityExportDeclaration = factory.createExportDeclaration(
      undefined,
      undefined,
      undefined,
      factory.createStringLiteral('./identity/index.js', true)
    );
    const updatedIndex = tsquery
      .map(
        ast(sharedConstructsIndexContents),
        'SourceFile',
        (node: SourceFile) => {
          return {
            ...node,
            statements: [identityExportDeclaration, ...node.statements],
          };
        }
      )
      .getFullText();

    if (sharedConstructsIndexContents !== updatedIndex) {
      tree.write(sharedConstructsIndexTsPath, updatedIndex);
    }
  }

  const mainTsxPath = joinPathFragments(srcRoot, 'main.tsx');

  if (!tree.exists(mainTsxPath)) {
    throw new Error(
      `Can only run this generator on a project which contains ${mainTsxPath}`
    );
  }

  const mainTsxContents = tree.read(mainTsxPath).toString();

  const authImport = factory.createImportDeclaration(
    undefined,
    factory.createImportClause(
      false,
      factory.createIdentifier('CognitoAuth'),
      undefined
    ) as ImportClause,
    factory.createStringLiteral('./components/CognitoAuth', true)
  );

  const updatedImports = tsquery
    .map(ast(mainTsxContents), 'SourceFile', (node: SourceFile) => {
      return {
        ...node,
        statements: [authImport, ...node.statements],
      };
    })
    .getFullText();

  let locatedTargetNode = false;
  const mainTsxUpdatedContents = tsquery
    .map(ast(updatedImports), 'JsxElement', (node: JsxElement) => {
      if (node.openingElement.tagName.getText() !== 'RuntimeConfigProvider') {
        return node;
      } else {
        locatedTargetNode = true;
      }

      return factory.createJsxElement(
        node.openingElement,
        [
          factory.createJsxElement(
            factory.createJsxOpeningElement(
              factory.createIdentifier('CognitoAuth'),
              undefined,
              factory.createJsxAttributes([])
            ),
            node.children,
            factory.createJsxClosingElement(
              factory.createIdentifier('CognitoAuth')
            )
          ),
        ],
        node.closingElement
      );
    })
    .getFullText();

  if (!locatedTargetNode) {
    throw new Error(
      'Could not locate the RuntimeConfigProvider element in main.tsx'
    );
  }

  if (locatedTargetNode && mainTsxContents !== mainTsxUpdatedContents) {
    tree.write(mainTsxPath, mainTsxUpdatedContents);
  }

  await formatFilesInSubtree(tree, srcRoot);

  return () => {
    installPackagesTask(tree);
  };
}

export default cognitoAuthGenerator;
