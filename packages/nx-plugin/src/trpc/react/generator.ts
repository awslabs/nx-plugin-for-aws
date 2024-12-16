/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  readProjectConfiguration,
  Tree,
} from '@nx/devkit';
import { ReactGeneratorSchema } from './schema';
import {
  factory,
  ImportClause,
  JsxSelfClosingElement,
  SourceFile,
} from 'typescript';
import { ast, tsquery } from '@phenomnomnominal/tsquery';
import { runtimeConfigGenerator } from '../../cloudscape-website/runtime-config/generator';
import { toScopeAlias } from '../../utils/npm-scope';
import { withVersions } from '../../utils/versions';
import { formatFilesInSubtree } from '../../utils/format';

export async function reactGenerator(
  tree: Tree,
  options: ReactGeneratorSchema
) {
  const frontendProjectConfig = readProjectConfiguration(
    tree,
    options.frontendProjectName
  );
  const backendProjectConfig = readProjectConfiguration(
    tree,
    options.backendProjectName
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const apiName = (backendProjectConfig.metadata as any)?.apiName;
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    frontendProjectConfig.root,
    {
      apiName,
      ...options,
      backendProjectAlias: toScopeAlias(options.backendProjectName),
    }
  );

  await runtimeConfigGenerator(tree, {
    project: options.frontendProjectName,
  });

  const mainTsxPath = joinPathFragments(
    frontendProjectConfig.sourceRoot,
    'main.tsx'
  );

  if (!tree.exists(mainTsxPath)) {
    throw new Error(
      `Could not find main.tsx in ${frontendProjectConfig.sourceRoot}`
    );
  }

  const mainTsxContents = tree.read(mainTsxPath).toString();

  const trpcProviderImport = factory.createImportDeclaration(
    undefined,
    factory.createImportClause(
      false,
      factory.createIdentifier('TRPCClientProvider'),
      undefined
    ) as ImportClause,
    factory.createStringLiteral('./components/TRPCClientProvider')
  );

  const updatedImports = tsquery
    .map(ast(mainTsxContents), 'SourceFile', (node: SourceFile) => {
      return {
        ...node,
        statements: [trpcProviderImport, ...node.statements],
      };
    })
    .getFullText();

  let locatedNode = false;
  const mainTsxUpdatedContents = tsquery
    .map(
      ast(updatedImports),
      'JsxSelfClosingElement',
      (node: JsxSelfClosingElement) => {
        if (node.tagName.getText() !== 'App') {
          return node;
        } else {
          locatedNode = true;
        }

        return factory.createJsxElement(
          factory.createJsxOpeningElement(
            factory.createIdentifier('TRPCClientProvider'),
            undefined,
            factory.createJsxAttributes([])
          ),
          [node],
          factory.createJsxClosingElement(
            factory.createIdentifier('TRPCClientProvider')
          )
        );
      }
    )
    .getFullText();

  if (!locatedNode) {
    throw new Error('Could not locate App component in main.tsx');
  }

  if (mainTsxContents !== mainTsxUpdatedContents) {
    tree.write(mainTsxPath, mainTsxUpdatedContents);
  }

  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@trpc/client',
      '@trpc/react-query',
      '@tanstack/react-query',
    ]),
    {}
  );

  await formatFilesInSubtree(tree, frontendProjectConfig.root);

  return () => {
    installPackagesTask(tree);
  };
}

export default reactGenerator;
