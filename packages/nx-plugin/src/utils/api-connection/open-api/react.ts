/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  joinPathFragments,
  ProjectConfiguration,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { kebabCase, toClassName } from '../../names';
import { sortObjectKeys } from '../../object';
import { updateGitIgnore } from '../../git';
import runtimeConfigGenerator from '../../../ts/react-website/runtime-config/generator';
import { query, replace } from '../../ast';
import { addTargetToServeLocal } from '../../../api-connection/serve-local';
import { JsxSelfClosingElement } from 'typescript';
import { addSingleImport, createJsxElementFromIdentifier } from '../../ast';
import { withVersions } from '../../versions';

export interface AddOpenApiReactClientOptions {
  /**
   * The react project to add the openapi client and build targets to
   */
  frontendProjectConfig: ProjectConfiguration;
  /**
   * The backend project which serves the api
   */
  backendProjectConfig: ProjectConfiguration;
  /**
   * The project which builds/generates the openapi spec
   */
  specBuildProject: ProjectConfiguration;
  /**
   * Name of the api
   */
  apiName: string;
  /**
   * Path to the openapi spec from the workspace root
   */
  specPath: string;
  /**
   * Fully qualified target name for the target that builds/generates the openapi spec
   */
  specBuildTargetName: string;
  /**
   * Authentication method
   */
  auth: 'IAM' | 'Cognito' | 'None';
  /**
   * Port on which the backend project's local server listens
   */
  port: number;
}

/**
 * Adds an OpenAPI React client to the frontend project along with supporting build targets
 */
export const addOpenApiReactClient = async (
  tree: Tree,
  {
    apiName,
    frontendProjectConfig,
    backendProjectConfig,
    specBuildProject,
    specPath,
    specBuildTargetName,
    auth,
    port,
  }: AddOpenApiReactClientOptions,
) => {
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
        dependsOn: [specBuildTargetName],
      },
      // Watch target for regenerating the client
      [clientGenWatchTarget]: {
        executor: 'nx:run-commands',
        options: {
          commands: [
            `nx watch --projects=${specBuildProject.name} --includeDependentProjects -- nx run ${frontendProjectConfig.name}:"${clientGenTarget}"`,
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
      joinPathFragments(__dirname, '../../files/website/hooks/sigv4'),
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
        '../../files/website/components/tanstack-query',
      ),
      joinPathFragments(frontendProjectConfig.sourceRoot, 'components'),
      {},
    );
  }

  const apiNameClassName = toClassName(apiName);

  // Add a hook to instantiate the client
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
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

  // Update serve-local on the website to use our local server
  addTargetToServeLocal(
    tree,
    frontendProjectConfig.name,
    backendProjectConfig.name,
    {
      url: `http://localhost:${port}/`,
      apiName,
      // Additionally add a dependency on the generate watch command to ensure that local
      // API changes that affect the client are also reloaded.
      // We include a dependency on the generate target as watch ONLY triggers on a change,
      // and we need to ensure the client is generated the first time if not already present.
      additionalDependencyTargets: [clientGenTarget, clientGenWatchTarget],
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
      '@tanstack/react-query-devtools',
    ]),
    withVersions(['@smithy/types']),
  );
};
