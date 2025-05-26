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
} from '../shared-constructs-constants';
import { addStarExport, prependStatements, query, replace } from '../ast';

interface BackendOptions {
  type: 'trpc' | 'fastapi';
}

export interface TrpcBackendOptions extends BackendOptions {
  type: 'trpc';
  projectAlias: string;
  dir: string;
}

export interface FastApiBackendOptions extends BackendOptions {
  type: 'fastapi';
  apiNameSnakeCase: string;
  dir: string;
}

export interface AddApiGatewayConstructOptions {
  apiNameClassName: string;
  apiNameKebabCase: string;
  constructType: 'http' | 'rest';
  backend: TrpcBackendOptions | FastApiBackendOptions;
  auth: 'IAM' | 'Cognito' | 'None';
}

/**
 * Add an API CDK construct, and update the Runtime Config type to export its url
 */
export const addApiGatewayConstruct = (
  tree: Tree,
  options: AddApiGatewayConstructOptions,
) => {
  const generateCoreApiFile = (name: string) => {
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'core', 'api', name),
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'core',
        'api',
      ),
      {},
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
  };

  // Generate relevant core CDK construct and utilities
  generateCoreApiFile(options.constructType);
  generateCoreApiFile('utils');
  if (options.backend.type === 'trpc') {
    generateCoreApiFile('trpc');
  }

  // Generate app specific CDK construct
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'app', 'apis', options.constructType),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'apis',
    ),
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Export app specific CDK construct
  addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'apis',
      'index.ts',
    ),
    `./${options.apiNameKebabCase}.js`,
  );
  addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'index.ts',
    ),
    './apis/index.js',
  );

  // Update runtime-config.ts with ApiUrl type and 'apis' property
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
  // Check if apis property exists in IRuntimeConfig
  const existingApis = query(
    tree,
    runtimeConfigPath,
    'InterfaceDeclaration[name.text="IRuntimeConfig"] PropertySignature[name.text="apis"]',
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
  // Add empty apis to IRuntimeConfig if it doesn't exist
  if (existingApis.length === 0) {
    replace(
      tree,
      runtimeConfigPath,
      'InterfaceDeclaration[name.text="IRuntimeConfig"]',
      (node: InterfaceDeclaration) => {
        const apisProperty = factory.createPropertySignature(
          undefined,
          factory.createIdentifier('apis'),
          undefined,
          factory.createTypeLiteralNode([]),
        );
        return factory.updateInterfaceDeclaration(
          node,
          node.modifiers,
          node.name,
          node.typeParameters,
          node.heritageClauses,
          [...node.members, apisProperty],
        );
      },
    );
  }
  // Check if apiNameClassName property exists in apis
  const existingApiNameProperty = query(
    tree,
    runtimeConfigPath,
    `InterfaceDeclaration[name.text="IRuntimeConfig"] PropertySignature[name.text="apis"] TypeLiteral PropertySignature[name.text="${options.apiNameClassName}"]`,
  );
  // Add apiNameClassName property to apis if it doesn't exist
  if (existingApiNameProperty.length === 0) {
    replace(
      tree,
      runtimeConfigPath,
      'InterfaceDeclaration[name.text="IRuntimeConfig"] PropertySignature[name.text="apis"] TypeLiteral',
      (node: TypeLiteralNode) => {
        return factory.createTypeLiteralNode([
          ...node.members,
          factory.createPropertySignature(
            undefined,
            factory.createIdentifier(options.apiNameClassName),
            undefined,
            factory.createTypeReferenceNode('ApiUrl', undefined),
          ),
        ]);
      },
    );
  }
};
