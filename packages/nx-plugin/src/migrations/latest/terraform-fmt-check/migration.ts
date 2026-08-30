/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type ProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import {
  TERRAFORM_FMT_TARGET,
  TERRAFORM_PROJECT_GENERATOR_INFO,
} from '../../../terraform/project/generator.js';
import { applyGritQL } from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { sortObjectKeys } from '../../../utils/object.js';

/**
 * The `fmt` target ran `terraform fmt`, which rewrites the files it reads. Those
 * files are its own declared `inputs`, so every run changed the hash it had just
 * been computed from and the target could never cache-hit — Nx reported it flaky
 * on every build.
 *
 * It now checks formatting, matching the TypeScript and Python `format` targets,
 * with the write moved to a `fix` configuration. A `lint` target orchestrates it
 * so `run-many --target lint` reaches Terraform projects and its `fix` and
 * `skip-lint` configurations propagate.
 *
 * The vended `providers.tf` backend block is realigned too, since the write the
 * old target performed on every run is what kept it formatted.
 */

/** The command the base target ran before it checked rather than wrote. */
const WRITING_COMMAND = 'terraform fmt';

/**
 * Backend arguments `terraform fmt` aligns to a common width but the generator
 * wrote unpadded. Matched on the name alone, so a user's own value survives.
 */
const BACKEND_ARGUMENTS = ['encrypt', 'use_lockfile'];

/**
 * Realigns the `backend "s3"` arguments in an application's `providers.tf`, which
 * the newly-checking target would otherwise reject on an untouched workspace.
 */
const realignProviders = async (
  tree: Tree,
  projectRoot: string,
): Promise<void> => {
  const filePath = joinPathFragments(projectRoot, 'src', 'providers.tf');
  if (!tree.exists(filePath)) return;

  const width = Math.max(...BACKEND_ARGUMENTS.map((name) => name.length));
  for (const name of BACKEND_ARGUMENTS) {
    await applyGritQL(
      tree,
      filePath,
      `language hcl\n\`${name} = $value\` => \`${name.padEnd(width)} = $value\`` +
        ` where { $value <: within \`backend "s3" { $_ }\` }`,
    );
  }
};

/**
 * Moves a project's `fmt` target onto the checking form and adds the `lint`
 * target that orchestrates it. A `fmt` whose command is no longer the one the
 * generator produced is the user's, so it is reported instead.
 */
const migrateProject = (
  projectName: string,
  project: ProjectConfiguration,
  nextSteps: string[],
): boolean => {
  const fmt = project.targets?.fmt;
  if (!fmt) return false;

  let changed = false;

  if (fmt.options?.command === WRITING_COMMAND) {
    project.targets.fmt = {
      ...fmt,
      inputs: TERRAFORM_FMT_TARGET.inputs,
      options: {
        ...fmt.options,
        command: TERRAFORM_FMT_TARGET.options.command,
      },
      configurations: {
        ...fmt.configurations,
        ...TERRAFORM_FMT_TARGET.configurations,
      },
    };
    changed = true;
  } else if (!fmt.configurations?.fix) {
    nextSteps.push(
      `${projectName}: its 'fmt' target has been customised, so it was left as it is. Have it run \`${TERRAFORM_FMT_TARGET.options.command}\` and move the writing form to a 'fix' configuration — writing from the base target rewrites the inputs its cache key is computed from, so it can never cache-hit.`,
    );
    return false;
  }

  if (!project.targets.lint) {
    project.targets.lint = { dependsOn: ['fmt'] };
    changed = true;
  }

  return changed;
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    const generator = (project.metadata as { generator?: string } | undefined)
      ?.generator;
    if (generator !== TERRAFORM_PROJECT_GENERATOR_INFO.id) continue;

    if (migrateProject(projectName, project, nextSteps)) {
      updateProjectConfiguration(tree, projectName, {
        ...project,
        targets: sortObjectKeys(project.targets),
      });
    }

    await realignProviders(tree, project.root);
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
