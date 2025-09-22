/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  ProjectConfiguration,
  Tree,
  updateJson,
} from '@nx/devkit';
import { IacProvider } from '../iac';
import { updateGitIgnore } from '../git';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../shared-constructs-constants';

export interface AddOpenApiMetadataGenerateTargetOptions {
  iacProvider: IacProvider;
  apiNameKebabCase: string;
  specPath: string;
  specBuildTargetName: string;
}

/**
 * Adds a generate:<api-name>-metadata target to shared constructs (CDK only)
 * This allows for API CDK constructs to have type-safety for integrations based on an OpenAPI Specification
 */
export const addSharedConstructsOpenApiMetadataGenerateTarget = (
  tree: Tree,
  {
    iacProvider,
    apiNameKebabCase,
    specPath,
    specBuildTargetName,
  }: AddOpenApiMetadataGenerateTargetOptions,
) => {
  if (iacProvider !== 'CDK') {
    // For Terraform, we do not support type-safe integration builders, rather only the single lambda
    // router pattern, and therefore do not need to add depenencies on metadata generation.
    return;
  }

  const generatedMetadataDir = joinPathFragments('generated', apiNameKebabCase);
  const generatedMetadataDirFromRoot = joinPathFragments(
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR),
    'src',
    generatedMetadataDir,
  );

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
      // If not already defined, add a target to generate metadata from the OpenAPI spec, used
      // for providing a type-safe CDK construct
      const metadataTargetName = `generate:${apiNameKebabCase}-metadata`;
      if (!config.targets[metadataTargetName]) {
        config.targets[metadataTargetName] = {
          cache: true,
          executor: 'nx:run-commands',
          inputs: [
            {
              dependentTasksOutputFiles: '**/*.json',
            },
          ],
          outputs: [
            joinPathFragments('{workspaceRoot}', generatedMetadataDirFromRoot),
          ],
          options: {
            commands: [
              `nx g @aws/nx-plugin:open-api#ts-metadata --openApiSpecPath="${specPath}" --outputPath="${generatedMetadataDirFromRoot}" --no-interactive`,
            ],
          },
          dependsOn: [specBuildTargetName],
        };
      }
      if (!config.targets.compile) {
        config.targets.compile = {};
      }
      config.targets.compile.dependsOn = [
        ...(config.targets.compile.dependsOn ?? []),
        metadataTargetName,
      ];
      return config;
    },
  );

  // Ignore the generated metadata by default
  // Users can safely remove the entry from the .gitignore if they prefer to check it in
  updateGitIgnore(
    tree,
    joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR),
    (patterns) => [...patterns, joinPathFragments('src', generatedMetadataDir)],
  );
};
