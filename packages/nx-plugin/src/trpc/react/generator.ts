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
import { addDefaultImportDeclarations, addJsxComponentWrapper } from '../../utils/typescript-ast';

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

  const updatedImports = addDefaultImportDeclarations(mainTsxContents, [
    { import: 'TRPCClientProvider', from: './components/TRPCClientProvider' },
  ]);

  const mainTsxUpdatedContents = addJsxComponentWrapper(updatedImports, 'App', 'TRPCClientProvider');

  if (!mainTsxUpdatedContents) {
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
