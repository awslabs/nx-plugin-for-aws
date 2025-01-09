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
import { JsxSelfClosingElement } from 'typescript';
import { runtimeConfigGenerator } from '../../cloudscape-website/runtime-config/generator';
import { toScopeAlias } from '../../utils/npm-scope';
import { withVersions } from '../../utils/versions';
import { formatFilesInSubtree } from '../../utils/format';
import { createJsxElementFromIdentifier, replace, singleImport } from '../../utils/ast';

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

  singleImport(
    tree,
    mainTsxPath,
    'TRPCClientProvider',
    './components/TRPCClientProvider'
  );

  replace(
    tree,
    mainTsxPath,
    'JsxSelfClosingElement[tagName.name="App"]',
    (node: JsxSelfClosingElement) =>
      createJsxElementFromIdentifier('TRPCClientProvider', [node])
  );

  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@aws-sdk/client-cognito-identity',
      '@aws-sdk/credential-provider-cognito-identity',
      '@trpc/client',
      '@trpc/react-query',
      '@tanstack/react-query',
      'aws4fetch',
      ...((options.auth === 'IAM'
        ? ['oidc-client-ts', 'react-oidc-context']
        : []) as any),
    ]),
    {}
  );

  await formatFilesInSubtree(tree, frontendProjectConfig.root);

  return () => {
    installPackagesTask(tree);
  };
}

export default reactGenerator;
