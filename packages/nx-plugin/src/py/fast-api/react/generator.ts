/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  ProjectConfiguration,
  readProjectConfiguration,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { FastApiReactGeneratorSchema } from './schema';
import { runtimeConfigGenerator } from '../../../cloudscape-website/runtime-config/generator';
import snakeCase from 'lodash.snakecase';
import * as path from 'path';
import kebabCase from 'lodash.kebabcase';
import { sortObjectKeys } from '../../../utils/nx';
import { toClassName } from '../../../utils/names';
import { formatFilesInSubtree } from '../../../utils/format';
import { withVersions } from '../../../utils/versions';
import { updateGitIgnore } from '../../../utils/git';

export const fastApiReactGenerator = async (
  tree: Tree,
  options: FastApiReactGeneratorSchema,
) => {
  const frontendProjectConfig = readProjectConfiguration(
    tree,
    options.frontendProjectName,
  );
  const fastApiProjectConfig = readProjectConfiguration(
    tree,
    options.fastApiProjectName,
  );
  const moduleName = getFastApiModuleName(fastApiProjectConfig);

  // Add OpenAPI spec generation script to FastAPI spec (if it does not exist already)
  generateFiles(
    tree,
    path.join(__dirname, 'files/fast-api'),
    fastApiProjectConfig.root,
    {
      moduleName,
    },
  );

  // Instrument the script as part of the fastapi project build
  const fastApiOpenApiDist = joinPathFragments(
    'dist',
    fastApiProjectConfig.root,
    'openapi',
  );
  const specPath = joinPathFragments(fastApiOpenApiDist, 'openapi.json');
  updateProjectConfiguration(tree, options.fastApiProjectName, {
    ...fastApiProjectConfig,
    targets: sortObjectKeys({
      ...fastApiProjectConfig.targets,
      build: {
        ...fastApiProjectConfig.targets?.build,
        dependsOn: [
          ...(fastApiProjectConfig.targets?.build?.dependsOn ?? []).filter(
            (t) => t !== 'openapi',
          ),
          'openapi',
        ],
      },
      openapi: {
        cache: true,
        executor: 'nx:run-commands',
        outputs: [joinPathFragments('{workspaceRoot}', fastApiOpenApiDist)],
        options: {
          commands: [
            `uv run python ${joinPathFragments(fastApiProjectConfig.root, 'scripts', 'generate_open_api.py')} "${specPath}"`,
          ],
        },
      },
    }),
  });

  const apiName = (fastApiProjectConfig.metadata as any)?.apiName;
  const clientGenTarget = `generate:${kebabCase(apiName)}-client`;

  const generatedClientDir = joinPathFragments('generated', kebabCase(apiName));
  const generatedClientDirFromRoot = joinPathFragments(
    frontendProjectConfig.sourceRoot,
    generatedClientDir,
  );

  // Add TypeScript client generation to Frontend project.json
  updateProjectConfiguration(tree, options.frontendProjectName, {
    ...frontendProjectConfig,
    targets: sortObjectKeys({
      ...frontendProjectConfig.targets,
      // Generate should run before compile as the client is created as part of the website src
      compile: {
        ...frontendProjectConfig.targets?.build,
        dependsOn: [
          ...(frontendProjectConfig.targets?.build?.dependsOn ?? []).filter(
            (t) => t !== clientGenTarget,
          ),
          clientGenTarget,
        ],
      },
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
            `nx g @aws/nx-plugin:open-api#ts-client --openApiSpecPath="${specPath}" --outputPath="${generatedClientDirFromRoot}" --no-interactive`,
          ],
        },
        dependsOn: [`${options.fastApiProjectName}:openapi`],
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
    project: options.frontendProjectName,
  });

  // Add sigv4 fetch
  if (options.auth === 'IAM') {
    generateFiles(
      tree,
      joinPathFragments(__dirname, '../../../utils/files/website/hooks/sigv4'),
      joinPathFragments(frontendProjectConfig.sourceRoot, 'hooks'),
      {},
    );
  }

  // Add a hook to instantiate the client
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'website'),
    frontendProjectConfig.sourceRoot,
    {
      auth: options.auth,
      apiName,
      apiNameClassName: toClassName(apiName),
      generatedClientDir,
    },
  );

  addDependenciesToPackageJson(
    tree,
    withVersions([
      ...((options.auth === 'IAM'
        ? [
            'oidc-client-ts',
            'react-oidc-context',
            '@aws-sdk/client-cognito-identity',
            '@aws-sdk/credential-provider-cognito-identity',
            'aws4fetch',
          ]
        : []) as any),
    ]),
    withVersions(['@smithy/types']),
  );

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

const getFastApiModuleName = (projectConfig: ProjectConfiguration): string => {
  if (projectConfig.sourceRoot) {
    const sourceRootParts = projectConfig.sourceRoot.split('/');
    return sourceRootParts[sourceRootParts.length - 1];
  }
  const apiName = (projectConfig.metadata as any)?.apiName;
  if (apiName) {
    return snakeCase(apiName);
  }
  new Error(`Could not determine sourceRoot for project ${projectConfig.name}`);
};

export default fastApiReactGenerator;
