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
  Tree,
} from '@nx/devkit';
import { ReactGeneratorSchema } from './schema';
import { JsxSelfClosingElement } from 'typescript';
import { runtimeConfigGenerator } from '../../cloudscape-website/runtime-config/generator';
import { toScopeAlias } from '../../utils/npm-scope';
import { withVersions } from '../../utils/versions';
import {
  createJsxElementFromIdentifier,
  replace,
  addSingleImport,
  query,
} from '../../utils/ast';
import { toClassName } from '../../utils/names';
import { formatFilesInSubtree } from '../../utils/format';
import {
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { addTargetToServeLocal } from '../../api-connection/serve-local';

export const TRPC_REACT_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function reactGenerator(
  tree: Tree,
  options: ReactGeneratorSchema,
) {
  const frontendProjectConfig = readProjectConfigurationUnqualified(
    tree,
    options.frontendProjectName,
  );
  const backendProjectConfig = readProjectConfigurationUnqualified(
    tree,
    options.backendProjectName,
  );
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const metadata = backendProjectConfig.metadata as any;
  const apiName = metadata.apiName;
  const auth = metadata.auth ?? 'IAM';
  const port = metadata.port ?? 2022;
  const apiNameClassName = toClassName(apiName);
  const backendProjectAlias = toScopeAlias(backendProjectConfig.name);

  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    frontendProjectConfig.root,
    {
      apiName,
      apiNameClassName: toClassName(apiName),
      ...options,
      auth,
      backendProjectAlias,
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

  if (auth === 'IAM') {
    generateFiles(
      tree,
      joinPathFragments(__dirname, '../../utils/files/website/hooks/sigv4'),
      joinPathFragments(frontendProjectConfig.sourceRoot, 'hooks'),
      {},
    );
  }

  await runtimeConfigGenerator(tree, {
    project: frontendProjectConfig.name,
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

  const clientProviderName = `${apiNameClassName}ClientProvider`;
  addSingleImport(
    tree,
    mainTsxPath,
    clientProviderName,
    `./components/${clientProviderName}`,
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
      'JsxSelfClosingElement[tagName.name="App"]',
      (node: JsxSelfClosingElement) =>
        createJsxElementFromIdentifier('QueryClientProvider', [node]),
    );
  }

  // Check if client provider already exists
  const hasProvider =
    query(
      tree,
      mainTsxPath,
      `JsxOpeningElement[tagName.name="${clientProviderName}"]`,
    ).length > 0;
  if (!hasProvider) {
    replace(
      tree,
      mainTsxPath,
      'JsxSelfClosingElement[tagName.name="App"]',
      (node: JsxSelfClosingElement) =>
        createJsxElementFromIdentifier(clientProviderName, [node]),
    );
  }

  addTargetToServeLocal(
    tree,
    frontendProjectConfig.name,
    backendProjectConfig.name,
    {
      url: `http://localhost:${port}/`,
      apiName,
    },
  );

  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@trpc/client',
      '@trpc/tanstack-react-query',
      '@tanstack/react-query',
      ...((auth === 'IAM'
        ? [
            'oidc-client-ts',
            'aws4fetch',
            '@aws-sdk/client-cognito-identity',
            '@aws-sdk/credential-provider-cognito-identity',
            'react-oidc-context',
          ]
        : []) as any),
      ...((auth === 'Cognito' ? ['react-oidc-context'] : []) as any),
    ]),
    withVersions(['@smithy/types']),
  );

  await addGeneratorMetricsIfApplicable(tree, [TRPC_REACT_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
}
export default reactGenerator;
