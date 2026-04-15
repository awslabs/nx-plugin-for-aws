/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  ProjectConfiguration,
  Tree,
  updateJson,
} from '@nx/devkit';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../shared-constructs-constants';
import { addStarExport } from '../ast';
import { IacProvider } from '../iac';
import { generateCoreApiCdkFiles } from '../api-constructs/api-constructs';

export interface AddEcsInfraOptions {
  apiProjectName: string;
  apiNameClassName: string;
  apiNameKebabCase: string;
  backendProjectAlias: string;
  backendRoot: string;
  port: number;
  auth: 'IAM' | 'Cognito' | 'None';
}

export const addEcsInfra = (
  tree: Tree,
  options: AddEcsInfraOptions & { iacProvider: IacProvider },
) => {
  if (options.iacProvider === 'CDK') {
    addEcsCdkConstructs(tree, options);
  } else {
    throw new Error(
      `ECS infrastructure is currently only supported with CDK, not ${options.iacProvider}`,
    );
  }

  updateJson(
    tree,
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'project.json'),
    (config: ProjectConfiguration) => {
      if (!config.targets) {
        config.targets = {};
      }
      if (!config.targets.build) {
        config.targets.build = {};
      }
      config.targets.build.dependsOn = [
        ...(config.targets.build.dependsOn ?? []),
        `${options.apiProjectName}:bundle`,
      ];
      return config;
    },
  );
};

const addEcsCdkConstructs = (tree: Tree, options: AddEcsInfraOptions) => {
  // Generate core ECS construct
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'cdk', 'core', 'ecs'),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'core',
      'ecs',
    ),
    {},
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Generate shared core API CDK files (utils, trpc, http)
  generateCoreApiCdkFiles(tree, ['utils', 'trpc', 'http']);

  // Generate app-specific ECS construct
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'cdk', 'app', 'ecs-apis'),
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'ecs-apis',
    ),
    options,
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Export app-specific ECS construct
  addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'ecs-apis',
      'index.ts',
    ),
    `./${options.apiNameKebabCase}.js`,
  );
  addStarExport(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'index.ts',
    ),
    './ecs-apis/index.js',
  );
};
