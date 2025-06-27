/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  factory,
  SyntaxKind,
  NodeFlags,
  TypeAliasDeclaration,
  TypeLiteralNode,
  ObjectLiteralExpression,
  PropertyAssignment,
  Block,
  VariableStatement,
  Identifier,
  CallExpression,
  JsxSelfClosingElement,
  JsxAttribute,
  JsxExpression,
  ArrowFunction,
} from 'typescript';
import { addDestructuredImport, query, replace } from '../ast';
import { Tree } from '@nx/devkit';

export interface AddHookResultToRouterProviderContextProps {
  hook: string; // eg useAuth
  module: string; // eg. react-oidc-context
  contextProp: string; // eg. auth
}

export const addHookResultToRouterProviderContext = (
  tree: Tree,
  mainTsxPath: string,
  { hook, module, contextProp }: AddHookResultToRouterProviderContextProps,
) => {
  addDestructuredImport(tree, mainTsxPath, [hook], module);

  // Update RouterProviderContext interface to include auth (if it exists)
  const routerProviderContextSelector =
    'TypeAliasDeclaration[name.text="RouterProviderContext"] > TypeLiteral';
  const hasRouterProviderContext =
    query(tree, mainTsxPath, routerProviderContextSelector).length > 0;

  const routerSelector =
    'CallExpression[expression.name="createRouter"] > ObjectLiteralExpression';
  const hasRouter = query(tree, mainTsxPath, routerSelector).length > 0;

  const appSelector = 'VariableDeclaration[name.text="App"] > ArrowFunction';
  const hasApp = query(tree, mainTsxPath, appSelector).length > 0;

  const routerProviderComponentSelector =
    'JsxSelfClosingElement:has(Identifier[name="RouterProvider"])';
  const hasRouterProviderComponent =
    query(tree, mainTsxPath, routerProviderComponentSelector).length > 0;

  if (
    !hasRouterProviderContext ||
    !hasRouter ||
    !hasApp ||
    !hasRouterProviderComponent
  ) {
    return;
  }

  replace(
    tree,
    mainTsxPath,
    routerProviderContextSelector,
    (node: TypeLiteralNode) => {
      // Check if auth property already exists
      if (node && node.members) {
        const hasContextProp = node.members.some(
          (member) =>
            member.name &&
            'text' in member.name &&
            member.name.text === contextProp,
        );

        if (!hasContextProp) {
          return factory.createTypeLiteralNode([
            ...node.members,
            factory.createPropertySignature(
              undefined,
              factory.createIdentifier(contextProp),
              factory.createToken(SyntaxKind.QuestionToken),
              factory.createTypeReferenceNode(
                factory.createIdentifier('ReturnType'),
                [factory.createTypeQueryNode(factory.createIdentifier(hook))],
              ),
            ),
          ]);
        }
      }
      return node;
    },
  );

  // Update router context to include context property
  replace(
    tree,
    mainTsxPath,
    routerSelector,
    (node: ObjectLiteralExpression) => {
      const routerContext = node.properties.find(
        (prop) =>
          prop.name && 'text' in prop.name && prop.name.text === 'context',
      ) as PropertyAssignment | undefined;
      const existingContextProps =
        routerContext &&
        routerContext.initializer.kind === SyntaxKind.ObjectLiteralExpression
          ? (routerContext.initializer as ObjectLiteralExpression).properties
          : [];
      return factory.createObjectLiteralExpression(
        [
          ...node.properties.filter(
            (prop) =>
              prop.name && 'text' in prop.name && prop.name.text !== 'context',
          ),
          factory.createPropertyAssignment(
            'context',
            factory.createObjectLiteralExpression(
              [
                ...existingContextProps.filter(
                  (prop) =>
                    prop.name &&
                    'text' in prop.name &&
                    prop.name.text !== contextProp,
                ),
                factory.createPropertyAssignment(
                  contextProp,
                  factory.createIdentifier('undefined'),
                ),
              ],
              true,
            ),
          ),
        ],
        true,
      );
    },
  );

  // Update App component to use the hook in RouterProvider context

  replace(tree, mainTsxPath, appSelector, (node: ArrowFunction) => {
    // Create a block which either is the arrow function's block or is a block with a single statement which returns the expression if it's an expression
    const isBlockBody = node.body.kind === SyntaxKind.Block;
    const existingBlock = isBlockBody ? (node.body as Block) : null;
    const existingStatements = existingBlock ? existingBlock.statements : [];

    const hasHookCall = existingStatements.find((statement) => {
      if (statement.kind === SyntaxKind.VariableStatement) {
        const variableStatement = statement as VariableStatement;
        const declaration = variableStatement.declarationList.declarations[0];

        if (
          declaration &&
          declaration.name.kind === SyntaxKind.Identifier &&
          (declaration.name as Identifier).text === contextProp &&
          declaration.initializer &&
          declaration.initializer.kind === SyntaxKind.CallExpression
        ) {
          const callExpression = declaration.initializer as CallExpression;
          if (
            callExpression.expression.kind === SyntaxKind.Identifier &&
            (callExpression.expression as Identifier).text === hook
          ) {
            return true;
          }
        }
      }
      return false;
    });

    if (!hasHookCall) {
      // Prepend the following statement: `const <contextProp> = <hook>();`
      const newStatements = [
        factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                factory.createIdentifier(contextProp),
                undefined,
                undefined,
                factory.createCallExpression(
                  factory.createIdentifier(hook),
                  undefined,
                  [],
                ),
              ),
            ],
            NodeFlags.Const,
          ),
        ),
        // Add existing statements or create return statement for expression body
        ...(isBlockBody
          ? existingStatements
          : [factory.createReturnStatement(node.body)]),
      ];

      return factory.createArrowFunction(
        node.modifiers,
        node.typeParameters,
        node.parameters,
        node.type,
        node.equalsGreaterThanToken,
        factory.createBlock(newStatements, true),
      );
    }

    return node;
  });

  // Add the context prop to the RouterProvider context prop, eg: <RouterProvider router={router} context={{ ...existing, <contextProp> }} />;
  replace(
    tree,
    mainTsxPath,
    routerProviderComponentSelector,
    (node: JsxSelfClosingElement) => {
      // Find existing context attribute
      const existingContextAttr = node.attributes.properties.find(
        (attr) =>
          attr.kind === SyntaxKind.JsxAttribute &&
          attr.name &&
          attr.name.kind === SyntaxKind.Identifier &&
          attr.name.text === 'context',
      ) as JsxAttribute | undefined;

      // Get existing context properties if they exist
      const existingContextProps =
        existingContextAttr &&
        existingContextAttr.initializer &&
        existingContextAttr.initializer.kind === SyntaxKind.JsxExpression &&
        (existingContextAttr.initializer as JsxExpression).expression &&
        (existingContextAttr.initializer as JsxExpression).expression!.kind ===
          SyntaxKind.ObjectLiteralExpression
          ? (
              (existingContextAttr.initializer as JsxExpression)
                .expression as ObjectLiteralExpression
            ).properties
          : [];

      // Create new context attribute with existing props plus the new context prop
      const newContextAttr = factory.createJsxAttribute(
        factory.createIdentifier('context'),
        factory.createJsxExpression(
          undefined,
          factory.createObjectLiteralExpression([
            // Add existing properties
            ...existingContextProps,
            // Add the new context prop as shorthand property assignment
            factory.createShorthandPropertyAssignment(
              factory.createIdentifier(contextProp),
            ),
          ]),
        ),
      );

      // Create new JSX self-closing element with all existing attributes except 'context', plus the new context attribute
      return factory.createJsxSelfClosingElement(
        node.tagName,
        node.typeArguments,
        factory.createJsxAttributes([
          // Include all existing attributes except 'context'
          ...node.attributes.properties.filter(
            (attr) =>
              !(
                attr.kind === SyntaxKind.JsxAttribute &&
                attr.name &&
                attr.name.kind === SyntaxKind.Identifier &&
                attr.name.text === 'context'
              ),
          ),
          // Add the new context attribute
          newContextAttr,
        ]),
      );
    },
  );
};
