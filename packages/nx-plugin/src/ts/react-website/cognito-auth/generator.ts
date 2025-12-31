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
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';
import { TsReactWebsiteAuthGeneratorSchema as TsReactWebsiteAuthGeneratorSchema } from './schema';
import { runtimeConfigGenerator } from '../runtime-config/generator';
import {
  ArrowFunction,
  Block,
  factory,
  JsxElement,
  NodeFlags,
  VariableDeclaration,
} from 'typescript';
import { withVersions } from '../../../utils/versions';
import {
  createJsxElement,
  createJsxElementFromIdentifier,
  addDestructuredImport,
  replace,
  addSingleImport,
} from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import {
  NxGeneratorInfo,
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { addHookResultToRouterProviderContext } from '../../../utils/ast/website';
import { addIdentityInfra } from '../../../utils/identity-constructs/identity-constructs';
import { resolveIacProvider } from '../../../utils/iac';
import {
  addCloudscapeAuthMenu,
  addNoneAuthMenu,
  addShadcnAuthMenu,
} from './utils';

export const COGNITO_AUTH_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function tsReactWebsiteAuthGenerator(
  tree: Tree,
  options: TsReactWebsiteAuthGeneratorSchema,
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

  if (!options.cognitoDomain) {
    throw new Error('A Cognito domain must be specified!');
  }

  await runtimeConfigGenerator(tree, {
    project: options.project,
  });

  const iacProvider = await resolveIacProvider(tree, options.iacProvider);

  await sharedConstructsGenerator(tree, {
    iacProvider,
  });

  addIdentityInfra(tree, {
    iacProvider,
    allowSignup: options.allowSignup,
    cognitoDomain: options.cognitoDomain,
  });

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'app'),
    srcRoot,
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  addDependenciesToPackageJson(
    tree,
    withVersions(['oidc-client-ts', 'react-oidc-context']),
    {},
  );

  const mainTsxPath = joinPathFragments(srcRoot, 'main.tsx');

  addSingleImport(tree, mainTsxPath, 'CognitoAuth', './components/CognitoAuth');

  addHookResultToRouterProviderContext(tree, mainTsxPath, {
    hook: 'useAuth',
    module: 'react-oidc-context',
    contextProp: 'auth',
  });

  const projectConfiguration = readProjectConfigurationUnqualified(
    tree,
    options.project,
  );

  const uxProvider =
    (projectConfiguration.metadata as any)?.uxProvider ?? 'Cloudscape';

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
    // Add a top-level navigation menu that shows the signed-in user's profile and actions
    switch (uxProvider) {
      case 'Cloudscape':
        addCloudscapeAuthMenu(tree, appLayoutTsxPath);
        break;
      case 'Shadcn':
        addShadcnAuthMenu(tree, appLayoutTsxPath);
        break;
      case 'None':
        addNoneAuthMenu(tree, appLayoutTsxPath);
        break;
      default:
        throw new Error(
          `Top-level navigation menu to show the signed-in user for uxProvider "${uxProvider}" is not implemented.`,
        );
    }
  } else {
    console.info(
      `Skipping update to ${appLayoutTsxPath} as it does not exist.`,
    );
  }
  // End update App Layout

  addComponentGeneratorMetadata(
    tree,
    options.project,
    COGNITO_AUTH_GENERATOR_INFO,
  );

  await addGeneratorMetricsIfApplicable(tree, [COGNITO_AUTH_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
}
export default tsReactWebsiteAuthGenerator;
