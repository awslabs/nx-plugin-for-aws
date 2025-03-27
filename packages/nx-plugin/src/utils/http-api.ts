/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  Tree,
} from '@nx/devkit';
import {
  factory,
  SyntaxKind,
  InterfaceDeclaration,
  TypeLiteralNode,
} from 'typescript';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  TYPE_DEFINITIONS_DIR,
} from './shared-constructs-constants';
import { addStarExport, prependStatements, query, replace } from './ast';

export const addHttpApi = (tree: Tree, apiNameClassName: string) => {
  const shouldGenerateCoreFastApiConstruct = !tree.exists(
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'core',
      'http-api.ts',
    ),
  );
  if (shouldGenerateCoreFastApiConstruct) {
    generateFiles(
      tree,
      joinPathFragments(
        __dirname,
        'files',
        'http-api',
        SHARED_CONSTRUCTS_DIR,
        'src',
        'core',
      ),
      joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'core'),
      {},
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
    addStarExport(
      tree,
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'core',
        'index.ts',
      ),
      './http-api.js',
    );
  }

  // Update runtime-config.ts with ApiUrl type and httpApis property
  const runtimeConfigPath = joinPathFragments(
    PACKAGES_DIR,
    TYPE_DEFINITIONS_DIR,
    'src',
    'runtime-config.ts',
  );

  // Check if ApiUrl type exists
  const existingApiUrl = query(
    tree,
    runtimeConfigPath,
    'TypeAliasDeclaration[name.text="ApiUrl"]',
  );
  // Check if httpApis property exists in IRuntimeConfig
  const existinghttpApis = query(
    tree,
    runtimeConfigPath,
    'InterfaceDeclaration[name.text="IRuntimeConfig"] PropertySignature[name.text="httpApis"]',
  );

  // Add ApiUrl type if it doesn't exist
  if (existingApiUrl.length === 0) {
    const apiUrlType = factory.createTypeAliasDeclaration(
      [factory.createModifier(SyntaxKind.ExportKeyword)],
      factory.createIdentifier('ApiUrl'),
      undefined,
      factory.createKeywordTypeNode(SyntaxKind.StringKeyword),
    );
    prependStatements(tree, runtimeConfigPath, [apiUrlType]);
  }
  // Add empty httpApis to IRuntimeConfig if it doesn't exist
  if (existinghttpApis.length === 0) {
    replace(
      tree,
      runtimeConfigPath,
      'InterfaceDeclaration[name.text="IRuntimeConfig"]',
      (node: InterfaceDeclaration) => {
        const httpApisProperty = factory.createPropertySignature(
          undefined,
          factory.createIdentifier('httpApis'),
          undefined,
          factory.createTypeLiteralNode([]),
        );
        return factory.updateInterfaceDeclaration(
          node,
          node.modifiers,
          node.name,
          node.typeParameters,
          node.heritageClauses,
          [...node.members, httpApisProperty],
        );
      },
    );
  }
  // Check if apiNameClassName property exists in httpApis
  const existingApiNameProperty = query(
    tree,
    runtimeConfigPath,
    `InterfaceDeclaration[name.text="IRuntimeConfig"] PropertySignature[name.text="httpApis"] TypeLiteral PropertySignature[name.text="${apiNameClassName}"]`,
  );
  // Add apiNameClassName property to httpApis if it doesn't exist
  if (existingApiNameProperty.length === 0) {
    replace(
      tree,
      runtimeConfigPath,
      'InterfaceDeclaration[name.text="IRuntimeConfig"] PropertySignature[name.text="httpApis"] TypeLiteral',
      (node: TypeLiteralNode) => {
        return factory.createTypeLiteralNode([
          ...node.members,
          factory.createPropertySignature(
            undefined,
            factory.createIdentifier(apiNameClassName),
            undefined,
            factory.createTypeReferenceNode('ApiUrl', undefined),
          ),
        ]);
      },
    );
  }
};
