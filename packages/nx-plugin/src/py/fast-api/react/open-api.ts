/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type ProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { snakeCase } from '../../../utils/names';
import { sortObjectKeys } from '../../../utils/object';

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

  // Add OpenAPI spec generation script to FastAPI spec, preserving an existing
  // copy so re-running does not reformat it nondeterministically
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files/fast-api'),
    project.root,
    {
      moduleName,
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
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
        outputs: ['{workspaceRoot}/dist/{projectRoot}/openapi'],
        options: {
          commands: [
            'uv run python {projectRoot}/scripts/generate_open_api.py "dist/{projectRoot}/openapi/openapi.json"',
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
