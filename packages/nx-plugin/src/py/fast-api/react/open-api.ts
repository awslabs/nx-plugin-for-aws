/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  ProjectConfiguration,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { sortObjectKeys } from '../../../utils/object';
import { snakeCase } from '../../../utils/names';

export interface AddOpenApiGenerationOptions {
  project: ProjectConfiguration;
}

/**
 * Adds FastAPI -> OpenApi spec generation as part of the FastAPI project build
 */
export const addOpenApiGeneration = (
  tree: Tree,
  { project }: AddOpenApiGenerationOptions,
): { specPath: string } => {
  const moduleName = getFastApiModuleName(project);

  // Add OpenAPI spec generation script to FastAPI spec (if it does not exist already)
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files/fast-api'),
    project.root,
    {
      moduleName,
    },
  );

  // Instrument the script as part of the fastapi project build
  const fastApiOpenApiDist = joinPathFragments('dist', project.root, 'openapi');
  const specPath = joinPathFragments(fastApiOpenApiDist, 'openapi.json');
  updateProjectConfiguration(tree, project.name, {
    ...project,
    targets: sortObjectKeys({
      ...project.targets,
      build: {
        ...project.targets?.build,
        dependsOn: [
          ...(project.targets?.build?.dependsOn ?? []).filter(
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
            `uv run python ${joinPathFragments(project.root, 'scripts', 'generate_open_api.py')} "${specPath}"`,
          ],
        },
      },
    }),
  });

  return { specPath };
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
