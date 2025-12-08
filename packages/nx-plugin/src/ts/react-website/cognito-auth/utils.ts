/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { replace } from '../../../utils/ast';
import {
  factory,
  isJsxAttribute,
  isStringLiteral,
  JsxAttribute,
  JsxElement,
  JsxSelfClosingElement,
  SyntaxKind,
} from 'typescript';

// Adds a user greeting and sign-out button to the default AppLayout header when using the None UX provider.
export function addNoneAuthMenu(tree: Tree, appLayoutTsxPath: string) {
  function isAppHeaderInner(node: JsxElement): boolean {
    const opening = node.openingElement;
    const classAttr = opening.attributes.properties.find(
      (prop): prop is JsxAttribute =>
        isJsxAttribute(prop) && prop.name.getText() === 'className',
    );

    const classValue =
      classAttr?.initializer && isStringLiteral(classAttr.initializer)
        ? classAttr.initializer.text
        : undefined;

    return classValue === 'app-header-inner';
  }

  replace(
    tree,
    appLayoutTsxPath,
    'JsxElement:has(JsxOpeningElement JsxAttribute[name.text="className"] StringLiteral[text="app-header-inner"])',
    (node: JsxElement) => {
      if (!isAppHeaderInner(node)) {
        return node;
      }
      const userGreeting = factory.createJsxElement(
        factory.createJsxOpeningElement(
          factory.createIdentifier('div'),
          undefined,
          factory.createJsxAttributes([
            factory.createJsxAttribute(
              factory.createIdentifier('className'),
              factory.createStringLiteral('user-greeting'),
            ),
          ]),
        ),
        [
          factory.createJsxElement(
            factory.createJsxOpeningElement(
              factory.createIdentifier('span'),
              undefined,
              factory.createJsxAttributes([]),
            ),
            [
              factory.createJsxText('Hi, '),
              factory.createJsxExpression(
                undefined,
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
            ],
            factory.createJsxClosingElement(factory.createIdentifier('span')),
          ),
          factory.createJsxElement(
            factory.createJsxOpeningElement(
              factory.createIdentifier('button'),
              undefined,
              factory.createJsxAttributes([
                factory.createJsxAttribute(
                  factory.createIdentifier('type'),
                  factory.createStringLiteral('button'),
                ),
                factory.createJsxAttribute(
                  factory.createIdentifier('className'),
                  factory.createStringLiteral('signout-link'),
                ),
                factory.createJsxAttribute(
                  factory.createIdentifier('onClick'),
                  factory.createJsxExpression(
                    undefined,
                    factory.createArrowFunction(
                      undefined,
                      undefined,
                      [],
                      undefined,
                      factory.createToken(SyntaxKind.EqualsGreaterThanToken),
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
                                factory.createObjectLiteralExpression(
                                  [
                                    factory.createPropertyAssignment(
                                      'post_logout_redirect_uri',
                                      factory.createPropertyAccessExpression(
                                        factory.createPropertyAccessExpression(
                                          factory.createIdentifier('window'),
                                          factory.createIdentifier('location'),
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
                                            factory.createStringLiteral('code'),
                                          ),
                                        ],
                                        true,
                                      ),
                                    ),
                                  ],
                                  true,
                                ),
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
                  ),
                ),
              ]),
            ),
            [factory.createJsxText('Sign out')],
            factory.createJsxClosingElement(factory.createIdentifier('button')),
          ),
        ],
        factory.createJsxClosingElement(factory.createIdentifier('div')),
      );
      return factory.createJsxElement(
        node.openingElement,
        [...node.children, userGreeting],
        node.closingElement,
      );
    },
  );
}

// Adds a top navigation dropdown with sign-out when using the Cloudscape UX provider..
export function addCloudscapeAuthMenu(tree: Tree, appLayoutTsxPath: string) {
  replace(
    tree,
    appLayoutTsxPath,
    'JsxSelfClosingElement[tagName.text="TopNavigation"]',
    (node: JsxSelfClosingElement) => {
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
                                            factory.createIdentifier('window'),
                                            factory.createIdentifier(
                                              'location',
                                            ),
                                          ),
                                          factory.createIdentifier('origin'),
                                        ),
                                      ),
                                      factory.createPropertyAssignment(
                                        'extraQueryParams',
                                        factory.createObjectLiteralExpression([
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
                                            factory.createStringLiteral('code'),
                                          ),
                                        ]),
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
}
