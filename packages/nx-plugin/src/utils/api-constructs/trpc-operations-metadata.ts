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
  updateJson,
} from '@nx/devkit';
import { OPERATIONS_METADATA_FILE_NAME } from '../../open-api/json-metadata/generator.js';
import { updateGitIgnore } from '../git.js';
import { addArtifactDependencyToTargets } from '../nx.js';
import {
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants.js';
import { terraformOperationsMetadataDir } from './open-api-metadata.js';

export interface AddTrpcOperationsMetadataTargetOptions {
  apiNameKebabCase: string;
  /** The tRPC backend project the operations are derived from. */
  project: ProjectConfiguration;
  /** Template variables for the vended script (module format). */
  templateOptions: Record<string, unknown>;
}

/**
 * Adds operations metadata generation for a tRPC API deployed with Terraform.
 *
 * tRPC has no OpenAPI specification, so the operations are derived by walking
 * the router: a vended script writes the same JSON shape the OpenAPI-based
 * generator produces, which the Terraform module reads to define one Lambda
 * function and route per procedure.
 */
export const addTrpcOperationsMetadataTarget = (
  tree: Tree,
  {
    apiNameKebabCase,
    project,
    templateOptions,
  }: AddTrpcOperationsMetadataTargetOptions,
) => {
  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      '..',
      '..',
      'trpc',
      'backend',
      'files-operations',
    ),
    project.root,
    templateOptions,
    {
      overwriteStrategy: OverwriteStrategy.Overwrite,
    },
  );

  const generatedDirFromRoot = joinPathFragments(
    PACKAGES_DIR,
    SHARED_TERRAFORM_DIR,
    'src',
    terraformOperationsMetadataDir(apiNameKebabCase),
  );
  const operationsFile = joinPathFragments(
    generatedDirFromRoot,
    OPERATIONS_METADATA_FILE_NAME,
  );

  project.targets ??= {};
  project.targets.operations ??= {
    cache: true,
    executor: 'nx:run-commands',
    outputs: [joinPathFragments('{workspaceRoot}', generatedDirFromRoot)],
    options: {
      commands: [
        `tsx {projectRoot}/scripts/generate-operations.ts ${operationsFile}`,
      ],
      cwd: '{workspaceRoot}',
    },
    dependsOn: ['compile'],
  };
  addArtifactDependencyToTargets(project, 'operations');

  // The shared Terraform project reads the generated file with `file()`, so it
  // must be written before that project is planned.
  updateJson(
    tree,
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'project.json'),
    (config: ProjectConfiguration) => {
      addArtifactDependencyToTargets(config, `${project.name}:operations`);
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
