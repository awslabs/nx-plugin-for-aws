/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type ProjectConfiguration,
  type Tree,
  updateJson,
} from '@nx/devkit';
import { updateGitIgnore } from '../git.js';
import type { Iac } from '../iac.js';
import { addDependencyToTargetIfNotPresent } from '../nx.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants.js';

export interface AddOpenApiMetadataGenerateTargetOptions {
  iac: Iac;
  apiNameKebabCase: string;
  specPath: string;
  specBuildTargetName: string;
  /**
   * How integrations are mapped to operations. Terraform only needs the
   * operations metadata for the `isolated` pattern, since the `shared` pattern
   * routes every operation to one proxy Lambda.
   */
  integrationPattern?: 'isolated' | 'shared';
}

/**
 * Adds a target which generates metadata about the API's operations from its
 * OpenAPI specification, so that infrastructure can define an integration per
 * operation.
 *
 * For CDK this generates TypeScript, giving the construct type-safe integrations.
 * For Terraform this generates JSON, which the vended module reads to build one
 * Lambda function and route per operation.
 */
export const addSharedConstructsOpenApiMetadataGenerateTarget = (
  tree: Tree,
  options: AddOpenApiMetadataGenerateTargetOptions,
) => {
  if (options.iac === 'cdk') {
    addCdkOpenApiMetadataGenerateTarget(tree, options);
  } else if (options.iac === 'terraform') {
    addTerraformOpenApiOperationsGenerateTarget(tree, options);
  }
};

const addCdkOpenApiMetadataGenerateTarget = (
  tree: Tree,
  {
    apiNameKebabCase,
    specPath,
    specBuildTargetName,
  }: AddOpenApiMetadataGenerateTargetOptions,
) => {
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
      addDependencyToTargetIfNotPresent(config, 'compile', metadataTargetName);
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

/**
 * Directory the operations metadata for an API is generated into, relative to
 * the shared Terraform project's `src`. The vended module reads the file from
 * here, so the module template and this target must agree on the location.
 */
export const terraformOperationsMetadataDir = (apiNameKebabCase: string) =>
  joinPathFragments('generated', apiNameKebabCase);

const addTerraformOpenApiOperationsGenerateTarget = (
  tree: Tree,
  {
    apiNameKebabCase,
    specPath,
    specBuildTargetName,
    integrationPattern,
  }: AddOpenApiMetadataGenerateTargetOptions,
) => {
  // The `shared` pattern routes every operation to a single proxy Lambda, so the
  // module has no need for the operations metadata.
  if (integrationPattern !== 'isolated') {
    return;
  }

  const generatedDirFromRoot = joinPathFragments(
    PACKAGES_DIR,
    SHARED_TERRAFORM_DIR,
    'src',
    terraformOperationsMetadataDir(apiNameKebabCase),
  );

  updateJson(
    tree,
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'project.json'),
    (config: ProjectConfiguration) => {
      config.targets ??= {};
      // Terraform reads the operations metadata with `file()`, so it must exist
      // before plan; the target is wired into `build` below.
      const operationsTargetName = `generate:${apiNameKebabCase}-operations`;
      if (!config.targets[operationsTargetName]) {
        config.targets[operationsTargetName] = {
          cache: true,
          executor: 'nx:run-commands',
          inputs: [
            {
              dependentTasksOutputFiles: '**/*.json',
            },
          ],
          outputs: [joinPathFragments('{workspaceRoot}', generatedDirFromRoot)],
          options: {
            commands: [
              `nx g @aws/nx-plugin:open-api#operations-metadata --openApiSpecPath="${specPath}" --outputPath="${generatedDirFromRoot}" --no-interactive`,
            ],
          },
          dependsOn: [specBuildTargetName],
        };
      }
      addDependencyToTargetIfNotPresent(config, 'build', operationsTargetName);
      return config;
    },
  );

  // Ignore the generated metadata by default
  // Users can safely remove the entry from the .gitignore if they prefer to check it in
  updateGitIgnore(
    tree,
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR),
    (patterns) => [
      ...patterns,
      joinPathFragments(
        'src',
        terraformOperationsMetadataDir(apiNameKebabCase),
      ),
    ],
  );
};
