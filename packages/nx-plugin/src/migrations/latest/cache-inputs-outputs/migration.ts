/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  type MigrationReturnObject,
  type ProjectConfiguration,
  readNxJson,
  type TargetConfiguration,
  type Tree,
  updateNxJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import {
  SMITHY_PROJECT_GENERATOR_INFO,
  SMITHY_TARGET_INPUTS,
} from '../../../smithy/project/generator.js';
import { TERRAFORM_PROJECT_GENERATOR_INFO } from '../../../terraform/project/generator.js';
import {
  DEPENDENT_TASKS_OUTPUT_FILES_INPUT,
  VENDED_DEPENDENT_TASKS_OUTPUT_GLOBS,
} from '../../../ts/lib/generator.js';
import { TS_RDB_GENERATOR_INFO } from '../../../ts/rdb/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * Fix what four generated targets hash, so cached results follow what each
 * task actually reads:
 *
 * - `nx.json`'s `default` input no longer hashes checkov reports
 *   (`dist/<project>/checkov/checkov_report.json`, CDK and Terraform) or vitest
 *   coverage (`dist/<project>/test-output/vitest/coverage/`) from upstream
 *   tasks. Nothing downstream reads them, and an uncached scan or coverage run
 *   rewrites them, which missed every dependent task.
 * - A Smithy project's `compile` and `generate-ssdk` declare `["default"]`,
 *   their own sources plus the outputs of the tasks they depend on, rather
 *   than relying on whatever target default applies. That hashes a consumed
 *   shape library's output only in a workspace where nx.json's `default`
 *   carries the `dependentTasksOutputFiles` entry, which only
 *   ts/lib/generator.ts writes.
 * - A ts#rdb project's `generate` (`prisma generate`) is cached on
 *   `["default"]`, which covers the Prisma schema and config. The Prisma
 *   version is hashed through the lockfile.
 * - A Terraform project's `output` is no longer cached: it reads remote state,
 *   which no input can hash, so a hit could replay values from before an apply.
 *
 * Each edit uses the generator's own constants, so a migrated workspace is
 * byte-identical to a freshly generated one, keys in the same order. A target
 * or glob that has diverged from the generated shape is left untouched and
 * reported.
 *
 * Changing `namedInputs.default` changes every task hash, so the first build
 * after migrating misses the cache throughout. Removing a churning input can
 * also let a target that reads a file it does not declare replay a stale
 * result, so that risk is reported whenever the glob is rewritten.
 */

const CURRENT_GLOB =
  DEPENDENT_TASKS_OUTPUT_FILES_INPUT.dependentTasksOutputFiles;

const STALE_PASS_ADVISORY =
  "nx.json's 'default' input no longer hashes checkov reports or vitest coverage from upstream tasks. A target that reads a file it does not declare as an input (for example a test reading README.md) can now replay a cached result after that file changes; add such files to the target's inputs.";

const SMITHY_TARGETS = ['compile', 'generate-ssdk'];
const RDB_INPUTS = ['default'];
const PRE_FIX_TERRAFORM_OUTPUT_INPUTS = ['default'];

const sameInputs = (
  inputs: TargetConfiguration['inputs'],
  expected: string[],
): boolean =>
  Array.isArray(inputs) &&
  inputs.length === expected.length &&
  inputs.every((input, index) => input === expected[index]);

const command = (target: TargetConfiguration): unknown =>
  target.options?.command;

/** Rewrites a previously vended glob; returns whether it did. */
const migrateGlob = (tree: Tree, nextSteps: string[]): boolean => {
  const nxJson = readNxJson(tree);
  const defaultInputs = nxJson?.namedInputs?.default;
  if (!nxJson || !Array.isArray(defaultInputs)) return false;

  // A dependentTasksOutputFiles entry is "vended" if it is already current or
  // is one of the globs this plugin has shipped (and so would be rewritten to
  // the current one below). An extra entry a user added beside it - neither
  // current nor vended - is their own scoping decision and is reported only
  // when no vended-or-current entry exists; otherwise it would be reported on
  // every run with advice that could widen hashing.
  const hasVendedOrCurrentEntry = defaultInputs.some(
    (input) =>
      typeof input === 'object' &&
      input !== null &&
      'dependentTasksOutputFiles' in input &&
      (input.dependentTasksOutputFiles === CURRENT_GLOB ||
        (input.transitive &&
          VENDED_DEPENDENT_TASKS_OUTPUT_GLOBS.includes(
            input.dependentTasksOutputFiles,
          ))),
  );

  let rewrote = false;
  nxJson.namedInputs.default = defaultInputs.map((input) => {
    if (typeof input !== 'object' || !('dependentTasksOutputFiles' in input)) {
      return input;
    }
    const glob = input.dependentTasksOutputFiles;
    if (glob === CURRENT_GLOB) return input;
    if (
      input.transitive &&
      VENDED_DEPENDENT_TASKS_OUTPUT_GLOBS.includes(glob)
    ) {
      rewrote = true;
      return { ...input, dependentTasksOutputFiles: CURRENT_GLOB };
    }
    if (!hasVendedOrCurrentEntry) {
      nextSteps.push(
        `nx.json: the 'default' input's dependentTasksOutputFiles '${glob}' has diverged from the generated shape - left untouched. Consider excluding checkov reports and vitest coverage ('${CURRENT_GLOB}'), which otherwise miss every dependent task whenever a scan or coverage run rewrites them.`,
      );
    }
    return input;
  });

  if (rewrote) updateNxJson(tree, nxJson);
  return rewrote;
};

const diverged = (projectName: string, targetName: string, advice: string) =>
  `${projectName}:${targetName}: has diverged from the generated shape - left untouched. ${advice}`;

/** Inserts `inputs` after `cache`, where the generator writes it. */
const migrateSmithyTarget = (
  projectName: string,
  targetName: string,
  target: TargetConfiguration,
  nextSteps: string[],
): TargetConfiguration | undefined => {
  if (sameInputs(target.inputs, SMITHY_TARGET_INPUTS)) return undefined;
  if (target.inputs !== undefined || target.executor !== 'nx:run-commands') {
    nextSteps.push(
      diverged(
        projectName,
        targetName,
        "Confirm its inputs cover the Smithy sources and the outputs of the tasks it depends on, as ['default'] does.",
      ),
    );
    return undefined;
  }
  const { cache, ...rest } = target;
  return { cache, inputs: [...SMITHY_TARGET_INPUTS], ...rest };
};

/** Inserts `cache` and `inputs` after `executor`, where the generator writes them. */
const migrateRdbGenerate = (
  projectName: string,
  target: TargetConfiguration,
  nextSteps: string[],
): TargetConfiguration | undefined => {
  if (target.cache === true && sameInputs(target.inputs, RDB_INPUTS)) {
    return undefined;
  }
  if (
    target.executor !== 'nx:run-commands' ||
    command(target) !== 'prisma generate' ||
    target.cache !== undefined ||
    target.inputs !== undefined
  ) {
    nextSteps.push(
      diverged(
        projectName,
        'generate',
        "To cache Prisma client generation, set cache: true and inputs: ['default'], which covers the Prisma schema and config.",
      ),
    );
    return undefined;
  }
  const { executor, ...rest } = target;
  return { executor, cache: true, inputs: [...RDB_INPUTS], ...rest };
};

/** Stops caching `output` in place and drops its inputs. */
const migrateTerraformOutput = (
  projectName: string,
  target: TargetConfiguration,
  nextSteps: string[],
): TargetConfiguration | undefined => {
  if (target.cache !== true) return undefined;
  if (
    !sameInputs(target.inputs, PRE_FIX_TERRAFORM_OUTPUT_INPUTS) ||
    command(target) !== 'terraform output -json'
  ) {
    nextSteps.push(
      diverged(
        projectName,
        'output',
        'A cached output can replay stale values after an apply; set cache: false.',
      ),
    );
    return undefined;
  }
  const { inputs: _inputs, ...rest } = target;
  return { ...rest, cache: false };
};

const migrateProject = (
  projectName: string,
  project: ProjectConfiguration,
  nextSteps: string[],
): boolean => {
  const generator = (project.metadata as { generator?: string } | undefined)
    ?.generator;
  const targets = project.targets ?? {};

  const migrations: [string, () => TargetConfiguration | undefined][] =
    generator === SMITHY_PROJECT_GENERATOR_INFO.id
      ? SMITHY_TARGETS.map((name) => [
          name,
          () =>
            migrateSmithyTarget(projectName, name, targets[name], nextSteps),
        ])
      : generator === TS_RDB_GENERATOR_INFO.id
        ? [
            [
              'generate',
              () =>
                migrateRdbGenerate(projectName, targets.generate, nextSteps),
            ],
          ]
        : generator === TERRAFORM_PROJECT_GENERATOR_INFO.id
          ? [
              [
                'output',
                () =>
                  migrateTerraformOutput(
                    projectName,
                    targets.output,
                    nextSteps,
                  ),
              ],
            ]
          : [];

  let changed = false;
  for (const [name, migrate] of migrations) {
    if (!targets[name]) continue;
    const migrated = migrate();
    if (migrated) {
      targets[name] = migrated;
      changed = true;
    }
  }
  return changed;
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  const rewroteGlob = migrateGlob(tree, nextSteps);

  for (const [projectName, project] of getProjects(tree)) {
    if (migrateProject(projectName, project, nextSteps)) {
      updateProjectConfiguration(tree, projectName, project);
    }
  }

  if (rewroteGlob) nextSteps.push(STALE_PASS_ADVISORY);

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
