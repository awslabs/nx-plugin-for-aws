/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  generateFiles,
  Tree,
  addDependenciesToPackageJson,
  installPackagesTask,
  OverwriteStrategy,
} from '@nx/devkit';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  TYPE_DEFINITIONS_DIR,
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import { TsCloudScapeWebsiteAuthGeneratorSchema as TsCloudScapeWebsiteAuthGeneratorSchema } from './schema';
import { runtimeConfigGenerator } from '../runtime-config/generator';
import {
  ArrowFunction,
  Block,
  factory,
  JsxElement,
  JsxSelfClosingElement,
  NodeFlags,
  SyntaxKind,
  VariableDeclaration,
  InterfaceDeclaration,
} from 'typescript';
import { withVersions } from '../../utils/versions';
import {
  addStarExport,
  createJsxElement,
  createJsxElementFromIdentifier,
  addDestructuredImport,
  replace,
  addSingleImport,
  prependStatements,
  query,
} from '../../utils/ast';
import { formatFilesInSubtree } from '../../utils/format';
import {
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';

export const COGNITO_AUTH_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function tsCloudScapeWebsiteAuthGenerator(
  tree: Tree,
  options: TsCloudScapeWebsiteAuthGeneratorSchema,
) {
  const srcRoot = readProjectConfigurationUnqualified(
    tree,
    options.project,
  ).sourceRoot;
  if (
    tree.exists(joinPathFragments(srcRoot, 'components/CognitoAuth/index.tsx'))
  ) {
    throw new Error(
      `This generator has already been run on ${options.project}.`,
    );
  }

  await runtimeConfigGenerator(tree, {
    project: options.project,
  });

  await sharedConstructsGenerator(tree);
  // Add ICognitoProps interface and update IRuntimeConfig
  const runtimeConfigPath = joinPathFragments(
    PACKAGES_DIR,
    TYPE_DEFINITIONS_DIR,
    'src',
    'runtime-config.ts',
  );
  // Check if ICognitoProps interface exists
  const existingCognitoProps = query(
    tree,
    runtimeConfigPath,
    'InterfaceDeclaration[name.text="ICognitoProps"]',
  );
  // Check if cognitoProps property exists in IRuntimeConfig
  const existingCognitoPropsInConfig = query(
    tree,
    runtimeConfigPath,
    'InterfaceDeclaration[name.text="IRuntimeConfig"] PropertySignature[name.text="cognitoProps"]',
  );

  // Add ICognitoProps interface if it doesn't exist
  if (existingCognitoProps.length === 0) {
    const cognitoPropsInterface = factory.createInterfaceDeclaration(
      [factory.createModifier(SyntaxKind.ExportKeyword)],
      factory.createIdentifier('ICognitoProps'),
      undefined,
      undefined,
      [
        factory.createPropertySignature(
          undefined,
          factory.createIdentifier('region'),
          undefined,
          factory.createKeywordTypeNode(SyntaxKind.StringKeyword),
        ),
        factory.createPropertySignature(
          undefined,
          factory.createIdentifier('identityPoolId'),
          undefined,
          factory.createKeywordTypeNode(SyntaxKind.StringKeyword),
        ),
        factory.createPropertySignature(
          undefined,
          factory.createIdentifier('userPoolId'),
          undefined,
          factory.createKeywordTypeNode(SyntaxKind.StringKeyword),
        ),
        factory.createPropertySignature(
          undefined,
          factory.createIdentifier('userPoolWebClientId'),
          undefined,
          factory.createKeywordTypeNode(SyntaxKind.StringKeyword),
        ),
      ],
    );

    prependStatements(tree, runtimeConfigPath, [cognitoPropsInterface]);
  }

  // Add cognitoProps to IRuntimeConfig if it doesn't exist
  if (existingCognitoPropsInConfig.length === 0) {
    replace(
      tree,
      runtimeConfigPath,
      'InterfaceDeclaration[name.text="IRuntimeConfig"]',
      (node: InterfaceDeclaration) => {
        return factory.updateInterfaceDeclaration(
          node,
          node.modifiers,
          node.name,
          node.typeParameters,
          node.heritageClauses,
          [
            ...node.members,
            factory.createPropertySignature(
              undefined,
              factory.createIdentifier('cognitoProps'),
              undefined,
              factory.createTypeReferenceNode('ICognitoProps', undefined),
            ),
          ],
        );
      },
    );
  }

  const identityPath = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
    'core',
    'user-identity.ts',
  );
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'app'),
    srcRoot,
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
  if (!tree.exists(identityPath)) {
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', SHARED_CONSTRUCTS_DIR),
      joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR),
      {
        allowSignup: options.allowSignup,
        cognitoDomain: options.cognitoDomain,
      },
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
    addDependenciesToPackageJson(
      tree,
      withVersions([
        'oidc-client-ts',
        'react-oidc-context',
        '@aws-cdk/aws-cognito-identitypool-alpha',
      ]),
      {},
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
      './user-identity.js',
    );
  }
  const mainTsxPath = joinPathFragments(srcRoot, 'main.tsx');
  addSingleImport(tree, mainTsxPath, 'CognitoAuth', './components/CognitoAuth');
  replace(
    tree,
    mainTsxPath,
    'JsxElement[openingElement.tagName.name="RuntimeConfigProvider"]',
    (node: JsxElement) =>
      createJsxElement(
        node.openingElement,
        [createJsxElementFromIdentifier('CognitoAuth', node.children)],
        node.closingElement,
      ),
  );
  // Update App Layout
  const appLayoutTsxPath = joinPathFragments(
    srcRoot,
    'components',
    'AppLayout',
    'index.tsx',
  );
  if (tree.exists(appLayoutTsxPath)) {
    addDestructuredImport(
      tree,
      appLayoutTsxPath,
      ['useAuth'],
      'react-oidc-context',
    );
    replace(
      tree,
      appLayoutTsxPath,
      'VariableDeclaration',
      (node: VariableDeclaration) => {
        // Only process if this is the App component
        if (node.name.getText() !== 'AppLayout') {
          return node;
        }
        const arrowFunction = node.initializer as ArrowFunction;
        const functionBody = arrowFunction.body as Block;
        // Create our new declaration
        const authDeclaration = factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                factory.createObjectBindingPattern([
                  factory.createBindingElement(
                    undefined,
                    undefined,
                    factory.createIdentifier('user'),
                    undefined,
                  ),
                  factory.createBindingElement(
                    undefined,
                    undefined,
                    factory.createIdentifier('removeUser'),
                    undefined,
                  ),
                  factory.createBindingElement(
                    undefined,
                    undefined,
                    factory.createIdentifier('signoutRedirect'),
                    undefined,
                  ),
                  factory.createBindingElement(
                    undefined,
                    undefined,
                    factory.createIdentifier('clearStaleState'),
                    undefined,
                  ),
                ]),
                undefined,
                undefined,
                factory.createCallExpression(
                  factory.createIdentifier('useAuth'),
                  undefined,
                  [],
                ),
              ),
            ],
            NodeFlags.Const,
          ),
        );
        // Add as first statement
        const newStatements = [authDeclaration, ...functionBody.statements];
        // Create new arrow function with updated body
        const newArrowFunction = factory.updateArrowFunction(
          arrowFunction,
          arrowFunction.modifiers,
          arrowFunction.typeParameters,
          arrowFunction.parameters,
          arrowFunction.type,
          arrowFunction.equalsGreaterThanToken,
          factory.createBlock(newStatements, true),
        );
        // Update the variable declaration
        return factory.updateVariableDeclaration(
          node,
          node.name,
          node.exclamationToken,
          node.type,
          newArrowFunction,
        );
      },
    );
    // TODO: update utils if they exist by appending to the array
    replace(
      tree,
      appLayoutTsxPath,
      'JsxSelfClosingElement[tagName.text="TopNavigation"]',
      (node: JsxSelfClosingElement) => {
        // Create the utilities attribute
        const utilitiesAttribute = factory.createJsxAttribute(
          factory.createIdentifier('utilities'),
          factory.createJsxExpression(
            undefined,
            factory.createArrayLiteralExpression(
              [
                factory.createObjectLiteralExpression([
                  factory.createPropertyAssignment(
                    'type',
                    factory.createStringLiteral('menu-dropdown'),
                  ),
                  factory.createPropertyAssignment(
                    'text',
                    factory.createTemplateExpression(
                      factory.createTemplateHead(''),
                      [
                        factory.createTemplateSpan(
                          factory.createElementAccessChain(
                            factory.createPropertyAccessChain(
                              factory.createIdentifier('user'),
                              factory.createToken(SyntaxKind.QuestionDotToken),
                              factory.createIdentifier('profile'),
                            ),
                            factory.createToken(SyntaxKind.QuestionDotToken),
                            factory.createStringLiteral('cognito:username'),
                          ),
                          factory.createTemplateTail(''),
                        ),
                      ],
                    ),
                  ),
                  factory.createPropertyAssignment(
                    'iconName',
                    factory.createStringLiteral('user-profile-active'),
                  ),
                  factory.createPropertyAssignment(
                    'onItemClick',
                    factory.createArrowFunction(
                      undefined,
                      undefined,
                      [
                        factory.createParameterDeclaration(
                          undefined,
                          undefined,
                          factory.createIdentifier('e'),
                          undefined,
                          undefined,
                          undefined,
                        ),
                      ],
                      undefined,
                      factory.createToken(SyntaxKind.EqualsGreaterThanToken),
                      factory.createBlock(
                        [
                          factory.createIfStatement(
                            factory.createBinaryExpression(
                              factory.createPropertyAccessExpression(
                                factory.createPropertyAccessExpression(
                                  factory.createIdentifier('e'),
                                  factory.createIdentifier('detail'),
                                ),
                                factory.createIdentifier('id'),
                              ),
                              factory.createToken(
                                SyntaxKind.EqualsEqualsEqualsToken,
                              ),
                              factory.createStringLiteral('signout'),
                            ),
                            factory.createBlock(
                              [
                                factory.createExpressionStatement(
                                  factory.createCallExpression(
                                    factory.createIdentifier('removeUser'),
                                    undefined,
                                    [],
                                  ),
                                ),
                                factory.createExpressionStatement(
                                  factory.createCallExpression(
                                    factory.createIdentifier('signoutRedirect'),
                                    undefined,
                                    [
                                      factory.createObjectLiteralExpression([
                                        factory.createPropertyAssignment(
                                          'post_logout_redirect_uri',
                                          factory.createPropertyAccessExpression(
                                            factory.createPropertyAccessExpression(
                                              factory.createIdentifier(
                                                'window',
                                              ),
                                              factory.createIdentifier(
                                                'location',
                                              ),
                                            ),
                                            factory.createIdentifier('origin'),
                                          ),
                                        ),
                                        factory.createPropertyAssignment(
                                          'extraQueryParams',
                                          factory.createObjectLiteralExpression(
                                            [
                                              factory.createPropertyAssignment(
                                                'redirect_uri',
                                                factory.createPropertyAccessExpression(
                                                  factory.createPropertyAccessExpression(
                                                    factory.createIdentifier(
                                                      'window',
                                                    ),
                                                    factory.createIdentifier(
                                                      'location',
                                                    ),
                                                  ),
                                                  factory.createIdentifier(
                                                    'origin',
                                                  ),
                                                ),
                                              ),
                                              factory.createPropertyAssignment(
                                                'response_type',
                                                factory.createStringLiteral(
                                                  'code',
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ]),
                                    ],
                                  ),
                                ),
                                factory.createExpressionStatement(
                                  factory.createCallExpression(
                                    factory.createIdentifier('clearStaleState'),
                                    undefined,
                                    [],
                                  ),
                                ),
                              ],
                              true,
                            ),
                          ),
                        ],
                        true,
                      ),
                    ),
                  ),
                  factory.createPropertyAssignment(
                    'items',
                    factory.createArrayLiteralExpression([
                      factory.createObjectLiteralExpression([
                        factory.createPropertyAssignment(
                          'id',
                          factory.createStringLiteral('signout'),
                        ),
                        factory.createPropertyAssignment(
                          'text',
                          factory.createStringLiteral('Sign out'),
                        ),
                      ]),
                    ]),
                  ),
                ]),
              ],
              true,
            ),
          ),
        );
        // Add the utilities attribute to existing attributes
        return factory.createJsxSelfClosingElement(
          node.tagName,
          node.typeArguments,
          factory.createJsxAttributes([
            ...node.attributes.properties,
            utilitiesAttribute,
          ]),
        );
      },
    );
  } else {
    console.info(
      `Skipping update to ${appLayoutTsxPath} as it does not exist.`,
    );
  }
  // End update App Layout

  await addGeneratorMetricsIfApplicable(tree, [COGNITO_AUTH_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
}
export default tsCloudScapeWebsiteAuthGenerator;
