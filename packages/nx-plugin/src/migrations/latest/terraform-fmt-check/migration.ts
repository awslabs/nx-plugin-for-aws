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
import { METRIC_ID } from '../../../utils/metrics.js';
import { sortObjectKeys } from '../../../utils/object.js';
import {
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';

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
 * The two vended Terraform files that `terraform fmt` would have rewritten are
 * realigned as well, so the newly-checking target passes on an untouched
 * workspace.
 */

/** The command the base target ran before it checked rather than wrote. */
const WRITING_COMMAND = 'terraform fmt';

const SHARED_TERRAFORM_SRC = joinPathFragments(
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
  'src',
);

/**
 * Assignments `terraform fmt` aligns to a common width but the generators wrote
 * unpadded, keyed by the file they live in and matched on the name alone so a
 * user's own value is preserved.
 */
const MISALIGNED_ASSIGNMENTS: Record<string, { name: string; pad: number }[]> =
  {
    [joinPathFragments(SHARED_TERRAFORM_SRC, 'metrics', 'metrics.tf')]: [
      { name: 'metric_id', pad: 'metric_version'.length },
      { name: 'Description', pad: 'AWSTemplateFormatVersion'.length },
    ],
    [joinPathFragments(
      SHARED_TERRAFORM_SRC,
      'core',
      'runtime-config',
      'read',
      'read.tf',
    )]: [
      { name: 'config_dir', pad: 'namespace_path'.length },
      { name: 'entries_dir', pad: 'namespace_path'.length },
      { name: 'namespace_path', pad: 'namespace_path'.length },
    ],
  };

/**
 * Realign an assignment to the width `terraform fmt` pads it to, leaving its
 * value as the user has it. Reports nothing: the check target names any file it
 * still rejects, and `fmt --configuration=fix` fixes it.
 */
const realign = async (
  tree: Tree,
  filePath: string,
  { name, pad }: { name: string; pad: number },
): Promise<void> => {
  await applyGritQL(
    tree,
    filePath,
    `language hcl\n\`${name} = $value\` => \`${name.padEnd(pad)} = $value\``,
  );
};

/** Realigns the vended Terraform files `terraform fmt` would rewrite. */
const realignVendedFiles = async (tree: Tree): Promise<void> => {
  for (const [filePath, assignments] of Object.entries(
    MISALIGNED_ASSIGNMENTS,
  )) {
    if (!tree.exists(filePath)) continue;
    // Only the file the generator produced is realigned, identified by the
    // metric id it carries; a user's own metrics block is left alone.
    if (
      filePath.endsWith('metrics.tf') &&
      !tree.read(filePath, 'utf-8')?.includes(METRIC_ID)
    ) {
      continue;
    }
    for (const assignment of assignments) {
      await realign(tree, filePath, assignment);
    }
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
  }

  await realignVendedFiles(tree);

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
