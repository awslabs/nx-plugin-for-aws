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
  TERRAFORM_FORMAT_TARGET,
  TERRAFORM_PROJECT_GENERATOR_INFO,
} from '../../../terraform/project/generator.js';
import { applyGritQL } from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { sortObjectKeys } from '../../../utils/object.js';

/**
 * Converges a Terraform project's format target on the shape ts and py projects
 * carry: a `format` target that checks, a `fix` configuration that writes, and a
 * `lint` target orchestrating it so `run-many --target lint` reaches Terraform
 * projects with its `fix` and `skip-lint` configurations propagating.
 *
 * The target was named `fmt` and ran `terraform fmt`, which rewrites the files it
 * reads. Those files are its own declared `inputs`, so every run changed the hash
 * it had just been computed from and it could never cache-hit — Nx reported it
 * flaky on every build. That per-run write is also what kept the vended
 * `providers.tf` backend block aligned, so this realigns it.
 */

/** The command the base target ran before it checked rather than wrote. */
const WRITING_COMMAND = 'terraform fmt';

/**
 * The `backend "s3"` arguments the generator vends. Realignment only applies to a
 * block holding exactly these.
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
 * Realigns the `backend "s3"` arguments in an application's `providers.tf`, which
 * the checking target requires and the per-run write had been supplying.
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
      `${filePath}: its \`backend "s3"\` block declares arguments beyond the generated ones, so its alignment was left as it is. Run \`nx run ${projectName}:format --configuration=fix\` if the new format check reports it.`,
    );
    return;
  }

  const width = Math.max(...BACKEND_ARGUMENTS.map((name) => name.length));

  // Already at the width `terraform fmt` aligns this block to, so a re-run — and
  // a workspace whose file is formatted — is a no-op.
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

/** The target name this migration converges on, matching ts and py projects. */
const FORMAT_TARGET = 'format';
/** The name the generator vended this target under before the rename. */
const LEGACY_TARGET = 'fmt';

/**
 * Repoints `dependsOn` entries naming the old target at the new one. A stale
 * entry is not an error in Nx — it silently drops the edge — so `build` would
 * stop checking formatting altogether.
 */
const repointDependsOn = (project: ProjectConfiguration): boolean => {
  let changed = false;
  for (const target of Object.values(project.targets ?? {})) {
    const dependsOn = target.dependsOn;
    if (!Array.isArray(dependsOn) || !dependsOn.includes(LEGACY_TARGET)) {
      continue;
    }
    target.dependsOn = dependsOn.map((entry) =>
      entry === LEGACY_TARGET ? FORMAT_TARGET : entry,
    );
    changed = true;
  }
  return changed;
};

/**
 * Renames the `fmt` target to `format`, moves it onto the checking form, and
 * adds the `lint` target that orchestrates it.
 *
 * A target whose command is not the one the generator produced is the user's, so
 * it is reported instead. Both the vended name and the new one are accepted as
 * the starting point, so a workspace part-way through converges either way.
 */
const migrateProject = (
  projectName: string,
  project: ProjectConfiguration,
  nextSteps: string[],
): boolean => {
  const targets = project.targets ?? {};
  const existingName = targets[FORMAT_TARGET]
    ? FORMAT_TARGET
    : targets[LEGACY_TARGET]
      ? LEGACY_TARGET
      : undefined;
  if (!existingName) return false;

  const format = targets[existingName];
  let changed = false;

  if (format.options?.command === WRITING_COMMAND) {
    targets[existingName] = {
      ...format,
      inputs: TERRAFORM_FORMAT_TARGET.inputs,
      options: {
        ...format.options,
        command: TERRAFORM_FORMAT_TARGET.options.command,
      },
      // The user's own configurations win, as their `options` do above: someone
      // who set `fix` to `terraform fmt -recursive` to cover nested modules
      // keeps it.
      configurations: {
        ...TERRAFORM_FORMAT_TARGET.configurations,
        ...format.configurations,
      },
    };
    changed = true;
  } else if (!format.configurations?.fix) {
    nextSteps.push(
      `${projectName}: its '${existingName}' target has been customised, so it was left as it is. Have it run \`${TERRAFORM_FORMAT_TARGET.options.command}\` and move the writing form to a 'fix' configuration — writing from the base target rewrites the inputs its cache key is computed from, so it can never cache-hit.`,
    );
    return false;
  }

  if (existingName === LEGACY_TARGET) {
    targets[FORMAT_TARGET] = targets[LEGACY_TARGET];
    delete targets[LEGACY_TARGET];
    changed = true;
  }

  changed = repointDependsOn(project) || changed;

  if (!targets.lint) {
    targets.lint = { dependsOn: [FORMAT_TARGET] };
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
