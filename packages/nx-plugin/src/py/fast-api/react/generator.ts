/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { FastApiReactGeneratorSchema } from './schema';
import { runtimeConfigGenerator } from '../../../cloudscape-website/runtime-config/generator';
import { sortObjectKeys } from '../../../utils/object';
import { kebabCase, toClassName } from '../../../utils/names';
import { formatFilesInSubtree } from '../../../utils/format';
import { withVersions } from '../../../utils/versions';
import { updateGitIgnore } from '../../../utils/git';
import {
  addSingleImport,
  createJsxElementFromIdentifier,
  query,
  replace,
} from '../../../utils/ast';
import { JsxSelfClosingElement } from 'typescript';
import {
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { addOpenApiGeneration } from './open-api';
import { addTargetToServeLocal } from '../../../api-connection/serve-local';

export const FAST_API_REACT_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const fastApiReactGenerator = async (
  tree: Tree,
  options: FastApiReactGeneratorSchema,
) => {
  const frontendProjectConfig = readProjectConfigurationUnqualified(
    tree,
    options.frontendProjectName,
  );
  const fastApiProjectConfig = readProjectConfigurationUnqualified(
    tree,
    options.fastApiProjectName,
  );

  // Add OpenAPI spec generation to the project, run as part of build
  const { specPath } = addOpenApiGeneration(tree, {
    project: fastApiProjectConfig,
  });

  const metadata = fastApiProjectConfig.metadata as any;
  const apiName = metadata?.apiName;
  const auth = metadata?.auth ?? 'IAM';
  const port = metadata?.port ?? 8000;
  const clientGenTarget = `generate:${kebabCase(apiName)}-client`;
  const clientGenWatchTarget = `watch-${clientGenTarget}`;

  const generatedClientDir = joinPathFragments('generated', kebabCase(apiName));
  const generatedClientDirFromRoot = joinPathFragments(
    frontendProjectConfig.sourceRoot,
    generatedClientDir,
  );

  // Add TypeScript client generation to Frontend project.json
  updateProjectConfiguration(tree, frontendProjectConfig.name, {
    ...frontendProjectConfig,
    targets: sortObjectKeys({
      ...frontendProjectConfig.targets,
      // Generate should run before compile and bundle as the client is created as part of the website src
      ...Object.fromEntries(
        ['compile', 'bundle'].map((target) => [
          target,
          {
            ...frontendProjectConfig.targets?.[target],
            dependsOn: [
              ...(
                frontendProjectConfig.targets?.[target]?.dependsOn ?? []
              ).filter((t) => t !== clientGenTarget),
              clientGenTarget,
            ],
          },
        ]),
      ),
      [clientGenTarget]: {
        cache: true,
        executor: 'nx:run-commands',
        inputs: [
          {
            dependentTasksOutputFiles: '**/*.json',
          },
        ],
        outputs: [
          joinPathFragments('{workspaceRoot}', generatedClientDirFromRoot),
        ],
        options: {
          commands: [
            `nx g @aws/nx-plugin:open-api#ts-hooks --openApiSpecPath="${specPath}" --outputPath="${generatedClientDirFromRoot}" --no-interactive`,
          ],
        },
        dependsOn: [`${fastApiProjectConfig.name}:openapi`],
      },
      // Watch target for regenerating the client
      [clientGenWatchTarget]: {
        executor: 'nx:run-commands',
        options: {
          commands: [
            `nx watch --projects=${fastApiProjectConfig.name} --includeDependentProjects -- nx run ${frontendProjectConfig.name}:"${clientGenTarget}"`,
          ],
        },
        continuous: true,
      },
    }),
  });

  const relativeSrcDir = frontendProjectConfig.sourceRoot.slice(
    frontendProjectConfig.root.length + 1,
  );

  // Ignore the generated client by default
  // Users can safely remove the entry from the .gitignore if they prefer to check it in
  updateGitIgnore(tree, frontendProjectConfig.root, (patterns) => [
    ...patterns,
    joinPathFragments(relativeSrcDir, generatedClientDir),
  ]);

  // Ensure that the frontend has runtime config as we'll use the url for creating the client
  await runtimeConfigGenerator(tree, {
    project: frontendProjectConfig.name,
  });

  // Add sigv4 fetch
  if (auth === 'IAM') {
    generateFiles(
      tree,
      joinPathFragments(__dirname, '../../../utils/files/website/hooks/sigv4'),
      joinPathFragments(frontendProjectConfig.sourceRoot, 'hooks'),
      {},
    );
  }

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
        '../../../utils/files/website/components/tanstack-query',
      ),
      joinPathFragments(frontendProjectConfig.sourceRoot, 'components'),
      {},
    );
  }

  const apiNameClassName = toClassName(apiName);

  // Add a hook to instantiate the client
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'website'),
    frontendProjectConfig.sourceRoot,
    {
      auth,
      apiName,
      apiNameClassName,
      generatedClientDir,
    },
  );

  // Update main.tsx to add required providers
  const mainTsxPath = joinPathFragments(
    frontendProjectConfig.sourceRoot,
    'main.tsx',
  );

  // Add the query client provider if it doesn't exist already
  const hasQueryClientProvider =
    query(
      tree,
      mainTsxPath,
      'JsxOpeningElement[tagName.name="QueryClientProvider"]',
    ).length > 0;

  if (!hasQueryClientProvider) {
    addSingleImport(
      tree,
      mainTsxPath,
      'QueryClientProvider',
      './components/QueryClientProvider',
    );
    replace(
      tree,
      mainTsxPath,
      'JsxSelfClosingElement[tagName.name="App"]',
      (node: JsxSelfClosingElement) =>
        createJsxElementFromIdentifier('QueryClientProvider', [node]),
    );
  }

  // Add the api provider if it does not exist
  const providerName = `${apiNameClassName}Provider`;
  const hasProvider =
    query(
      tree,
      mainTsxPath,
      `JsxOpeningElement[tagName.name="${providerName}"]`,
    ).length > 0;
  if (!hasProvider) {
    addSingleImport(
      tree,
      mainTsxPath,
      providerName,
      `./components/${providerName}`,
    );
    replace(
      tree,
      mainTsxPath,
      'JsxSelfClosingElement[tagName.name="App"]',
      (node: JsxSelfClosingElement) =>
        createJsxElementFromIdentifier(providerName, [node]),
    );
  }

  // Update serve-local on the website to use our local FastAPI server
  addTargetToServeLocal(
    tree,
    frontendProjectConfig.name,
    fastApiProjectConfig.name,
    {
      url: `http://localhost:${port}/`,
      apiName,
      // Additionally add a dependency on the generate watch command to ensure that local
      // FastAPI changes that affect the client are also reloaded
      additionalDependencyTargets: [clientGenWatchTarget],
    },
  );

  addDependenciesToPackageJson(
    tree,
    withVersions([
      ...((auth === 'IAM'
        ? [
            'oidc-client-ts',
            'react-oidc-context',
            '@aws-sdk/client-cognito-identity',
            '@aws-sdk/credential-provider-cognito-identity',
            'aws4fetch',
          ]
        : []) as any),
      ...((auth === 'Cognito' ? ['react-oidc-context'] : []) as any),
      '@tanstack/react-query',
    ]),
    withVersions(['@smithy/types']),
  );

  await addGeneratorMetricsIfApplicable(tree, [FAST_API_REACT_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default fastApiReactGenerator;
