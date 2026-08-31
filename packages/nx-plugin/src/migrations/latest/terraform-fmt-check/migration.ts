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
import { addLicenseCheckToLintTarget } from '../../../license/config.js';
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
 * The `backend "s3"` arguments the generator vends, which it wrote unpadded.
 * Realignment only applies to a block holding exactly these.
 */
const BACKEND_ARGUMENTS = ['encrypt', 'use_lockfile'];

/** Matches the arguments of a `backend "s3"` block, and their alignment. */
const BACKEND_BLOCK = /backend\s+"s3"\s*\{([^}]*)\}/;
const BACKEND_ARGUMENT = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)([ \t]*)=/gm;

/**
 * The arguments a `providers.tf` declares in its `backend "s3"` block, in order,
 * each with the column its `=` currently sits at.
 */
const readBackendArguments = (
  contents: string,
): { name: string; column: number }[] | undefined => {
  const block = BACKEND_BLOCK.exec(contents)?.[1];
  if (block === undefined) return undefined;
  return [...block.matchAll(BACKEND_ARGUMENT)].map(([, name, gap]) => ({
    name,
    column: name.length + gap.length,
  }));
};

/**
 * Realigns the `backend "s3"` arguments in an application's `providers.tf`. The
 * write the old target performed on every run is what had kept them aligned, so
 * the newly-checking target would otherwise reject an untouched workspace.
 *
 * `terraform fmt` aligns `=` to the widest key in the whole block, so a block
 * carrying arguments beyond the two vended ones has a width this cannot know.
 * Such a block is left alone and reported: rewriting it to the vended width
 * would push those two out of alignment with the user's own arguments and fail
 * the very check this migration installs.
 */
const realignProviders = async (
  tree: Tree,
  projectName: string,
  projectRoot: string,
  nextSteps: string[],
): Promise<void> => {
  const filePath = joinPathFragments(projectRoot, 'src', 'providers.tf');
  if (!tree.exists(filePath)) return;

  const declared = readBackendArguments(tree.read(filePath, 'utf-8') ?? '');
  if (!declared?.length) return;

  const isVendedBlock =
    declared.length === BACKEND_ARGUMENTS.length &&
    declared.every(({ name }) => BACKEND_ARGUMENTS.includes(name));
  if (!isVendedBlock) {
    nextSteps.push(
      `${filePath}: its \`backend "s3"\` block declares arguments beyond the generated ones, so its alignment was left as it is. Run \`nx run ${projectName}:fmt --configuration=fix\` if the new format check reports it.`,
    );
    return;
  }

  const width = Math.max(...BACKEND_ARGUMENTS.map((name) => name.length));

  // Already at the width `terraform fmt` aligns this block to, so a re-run — and
  // a workspace whose file is already formatted — is a no-op.
  if (declared.every(({ column }) => column === width)) return;

  // Each argument is realigned around whatever value it holds, so a value the
  // user changed is preserved. An argument whose name already fills the width
  // rewrites to a textually identical pattern, which GritQL notes; the rewrite
  // still normalises the whitespace around its `=`, which is the point.
  for (const { name } of declared) {
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
      // The user's own configurations win, as their `options` do above: someone
      // who set `fix` to `terraform fmt -recursive` to cover nested modules
      // keeps it.
      configurations: {
        ...TERRAFORM_FMT_TARGET.configurations,
        ...fmt.configurations,
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
      // The new `lint` target checks licenses alongside formatting, as every
      // other linting project's does in a workspace that has run `license`.
      addLicenseCheckToLintTarget(tree, projectName);
    }

    await realignProviders(tree, projectName, project.root, nextSteps);
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
