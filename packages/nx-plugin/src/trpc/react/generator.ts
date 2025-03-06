/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  readProjectConfiguration,
  Tree,
} from '@nx/devkit';
import { ReactGeneratorSchema } from './schema';
import {
  JsxSelfClosingElement,
  ObjectLiteralExpression,
  factory,
  ReturnStatement,
  Block,
  NodeFlags,
  JsxTagNameExpression,
  isJsxElement,
  isJsxFragment,
  isJsxSelfClosingElement,
  isJsxChild,
  isJsxExpression,
  isParenthesizedExpression,
} from 'typescript';
import { runtimeConfigGenerator } from '../../cloudscape-website/runtime-config/generator';
import { toScopeAlias } from '../../utils/npm-scope';
import { withVersions } from '../../utils/versions';
import {
  createJsxElementFromIdentifier,
  replace,
  addSingleImport,
  addDestructuredImport,
  query,
} from '../../utils/ast';
import { toClassName } from '../../utils/names';
import { formatFilesInSubtree } from '../../utils/format';
export async function reactGenerator(
  tree: Tree,
  options: ReactGeneratorSchema,
) {
  const frontendProjectConfig = readProjectConfiguration(
    tree,
    options.frontendProjectName,
  );
  const backendProjectConfig = readProjectConfiguration(
    tree,
    options.backendProjectName,
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const apiName = (backendProjectConfig.metadata as any)?.apiName;
  const apiNameClassName = toClassName(apiName);
  const backendProjectAlias = toScopeAlias(options.backendProjectName);

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    frontendProjectConfig.root,
    {
      apiName,
      apiNameClassName: toClassName(apiName),
      ...options,
      backendProjectAlias: toScopeAlias(options.backendProjectName),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Generate the tanstack query provider if it does not exist already
  if (
    !tree.exists(
      joinPathFragments(
        frontendProjectConfig.sourceRoot,
        'components',
        'QueryClientProvider.tsx',
      ),
    )
  ) {
    generateFiles(
      tree,
      joinPathFragments(
        __dirname,
        '../../utils/files/website/components/tanstack-query',
      ),
      joinPathFragments(frontendProjectConfig.sourceRoot, 'components'),
      {},
    );
  }

  if (options.auth === 'IAM') {
    generateFiles(
      tree,
      joinPathFragments(__dirname, '../../utils/files/website/hooks/sigv4'),
      joinPathFragments(frontendProjectConfig.sourceRoot, 'hooks'),
      {},
    );
  }
  await runtimeConfigGenerator(tree, {
    project: options.frontendProjectName,
  });

  // update main.tsx
  const mainTsxPath = joinPathFragments(
    frontendProjectConfig.sourceRoot,
    'main.tsx',
  );
  addSingleImport(
    tree,
    mainTsxPath,
    'QueryClientProvider',
    './components/QueryClientProvider',
  );
  addSingleImport(
    tree,
    mainTsxPath,
    'TrpcClientProviders',
    './components/TrpcClients',
  );

  // Check if QueryClientProvider already exists
  const hasQueryClientProvider =
    query(
      tree,
      mainTsxPath,
      'JsxOpeningElement[tagName.name="QueryClientProvider"]',
    ).length > 0;

  if (!hasQueryClientProvider) {
    replace(
      tree,
      mainTsxPath,
      'JsxSelfClosingElement[tagName.name="RouterProvider"]',
      (node: JsxSelfClosingElement) =>
        createJsxElementFromIdentifier('QueryClientProvider', [node]),
    );
  }

  // Check if TrpcClientProviders already exists
  const hasProvider =
    query(
      tree,
      mainTsxPath,
      'JsxOpeningElement[tagName.name="TrpcClientProviders"]',
    ).length > 0;
  if (!hasProvider) {
    replace(
      tree,
      mainTsxPath,
      'JsxSelfClosingElement[tagName.name="RouterProvider"]',
      (node: JsxSelfClosingElement) =>
        createJsxElementFromIdentifier('TrpcClientProviders', [node]),
    );
  }
  // update TrpcApis.tsx
  const trpcApisPath = joinPathFragments(
    frontendProjectConfig.sourceRoot,
    'components/TrpcClients/TrpcApis.tsx',
  );
  // Add imports if they don't exist
  addDestructuredImport(
    tree,
    trpcApisPath,
    ['createTrpcClientProvider'],
    './TrpcProvider',
  );
  addDestructuredImport(
    tree,
    trpcApisPath,
    [
      `AppRouter as ${apiNameClassName}AppRouter`,
      `Context as ${apiNameClassName}Context`,
    ],
    backendProjectAlias,
  );
  // Update the export object only if API doesn't exist
  replace(
    tree,
    trpcApisPath,
    'ExportAssignment > ObjectLiteralExpression',
    (node) => {
      const existingProperties = (node as ObjectLiteralExpression).properties;
      if (
        existingProperties.find((p) => p.name?.getText() === apiNameClassName)
      ) {
        return node;
      }
      const newProperty = factory.createPropertyAssignment(
        factory.createIdentifier(apiNameClassName),
        factory.createCallExpression(
          factory.createIdentifier('createTrpcClientProvider'),
          [
            factory.createTypeReferenceNode(
              factory.createIdentifier(`${apiNameClassName}AppRouter`),
            ),
            factory.createTypeReferenceNode(
              factory.createIdentifier(`${apiNameClassName}Context`),
            ),
          ],
          [],
        ),
      );
      return factory.createObjectLiteralExpression(
        [...existingProperties, newProperty],
        true,
      );
    },
  );
  // update TrpcClientProviders.tsx
  const trpcClientProvidersPath = joinPathFragments(
    frontendProjectConfig.sourceRoot,
    'components/TrpcClients/TrpcClientProviders.tsx',
  );
  // Add imports
  addDestructuredImport(
    tree,
    trpcClientProvidersPath,
    ['useRuntimeConfig'],
    '../../hooks/useRuntimeConfig',
  );
  addSingleImport(tree, trpcClientProvidersPath, 'TrpcApis', './TrpcApis');
  // Check if useContext hook exists and add if it doesn't add it
  const hasRuntimeConfig =
    query(
      tree,
      trpcClientProvidersPath,
      'VariableDeclaration[name.name="runtimeConfig"] CallExpression[expression.name="useRuntimeConfig"]',
    ).length > 0;
  if (!hasRuntimeConfig) {
    replace(
      tree,
      trpcClientProvidersPath,
      'ArrowFunction > Block',
      (node: Block) => {
        const existingStatements = [...node.statements];
        const runtimeContextVar = factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                'runtimeConfig',
                undefined,
                undefined,
                factory.createCallExpression(
                  factory.createIdentifier('useRuntimeConfig'),
                  undefined,
                  [],
                ),
              ),
            ],
            NodeFlags.Const,
          ),
        );
        // Insert the runtimeContext declaration before the return statement
        existingStatements.splice(
          existingStatements.length - 1,
          0,
          runtimeContextVar,
        );
        return factory.createBlock(existingStatements, true);
      },
    );
  }
  // Check if API provider already exists
  const hasTrpcProvider =
    query(
      tree,
      trpcClientProvidersPath,
      `JsxOpeningElement PropertyAccessExpression:has(Identifier[name="Provider"]) PropertyAccessExpression:has(Identifier[name="${apiNameClassName}"]) Identifier[name="TrpcApis"]`,
    ).length > 0;
  if (!hasTrpcProvider) {
    // Transform the return statement only if provider doesn't exist
    replace(
      tree,
      trpcClientProvidersPath,
      'ReturnStatement',
      (node: ReturnStatement) => {
        const existingExpression = isParenthesizedExpression(node.expression)
          ? node.expression?.expression
          : node.expression;
        return factory.createReturnStatement(
          factory.createJsxElement(
            factory.createJsxOpeningElement(
              factory.createPropertyAccessExpression(
                factory.createPropertyAccessExpression(
                  factory.createIdentifier('TrpcApis'),
                  factory.createIdentifier(apiNameClassName),
                ),
                factory.createIdentifier('Provider'),
              ) as JsxTagNameExpression,
              undefined,
              factory.createJsxAttributes([
                factory.createJsxAttribute(
                  factory.createIdentifier('apiUrl'),
                  factory.createJsxExpression(
                    undefined,
                    factory.createPropertyAccessExpression(
                      factory.createPropertyAccessExpression(
                        factory.createIdentifier('runtimeConfig'),
                        factory.createIdentifier('httpApis'),
                      ),
                      factory.createIdentifier(apiNameClassName),
                    ),
                  ),
                ),
              ]),
            ),
            [
              isJsxChild(existingExpression) ||
              isJsxElement(existingExpression) ||
              isJsxFragment(existingExpression) ||
              isJsxSelfClosingElement(existingExpression) ||
              isJsxExpression(existingExpression)
                ? existingExpression
                : factory.createJsxExpression(undefined, existingExpression),
            ],
            factory.createJsxClosingElement(
              factory.createPropertyAccessExpression(
                factory.createPropertyAccessExpression(
                  factory.createIdentifier('TrpcApis'),
                  factory.createIdentifier(apiNameClassName),
                ),
                factory.createIdentifier('Provider'),
              ) as JsxTagNameExpression,
            ),
          ),
        );
      },
    );
  }
  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@trpc/client',
      '@trpc/tanstack-react-query',
      '@tanstack/react-query',
      ...((options.auth === 'IAM'
        ? [
            'oidc-client-ts',
            'aws4fetch',
            '@aws-sdk/client-cognito-identity',
            '@aws-sdk/credential-provider-cognito-identity',
            'react-oidc-context',
          ]
        : []) as any),
    ]),
    withVersions(['@smithy/types']),
  );
  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
}
export default reactGenerator;
