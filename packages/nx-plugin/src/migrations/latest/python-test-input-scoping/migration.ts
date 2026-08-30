/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  type MigrationReturnObject,
  type ProjectConfiguration,
  readNxJson,
  type Tree,
  updateNxJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { PYTHON_TEST_FILE_EXCLUSIONS } from '../../../py/project/generator.js';
import { DEPENDENT_TASKS_OUTPUT_FILES_INPUT } from '../../../ts/lib/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * Editing a Python test file used to invalidate the whole build chain for its
 * project, and cascade into every downstream project. Two independent causes:
 *
 * 1. The `production` named input excluded TypeScript specs but nothing Python,
 *    and the Python build targets read `default` (every file in the project), so
 *    a test file was a build input by construction.
 * 2. `default` consumed *every* output of a dependency task. The Python `test`
 *    target writes JUnit and coverage reports that pytest stamps wall-clock time
 *    into, so each test run minted a new hash that propagated downstream.
 *
 * Targets whose output genuinely cannot contain a test file move to
 * `production`; `typecheck` deliberately stays on `default`, because `ty` checks
 * the tests directory and must re-run when a test changes.
 */

/** The Python targets whose declared output cannot contain a test file. */
const PRODUCTION_SCOPED_TARGETS = ['compile', 'bundle-x86', 'bundle-arm'];

/** The inputs those targets read once scoped to production sources. */
const PRODUCTION_INPUTS = ['production', '^production'];

/** The inputs those targets previously read. */
const PREVIOUS_INPUTS = ['default', '^production'];

const isPythonProject = (project: ProjectConfiguration): boolean =>
  Object.values(project.targets ?? {}).some((target) =>
    String(target?.executor ?? '').startsWith('@nxlv/python'),
  );

/** An OpenAPI spec generation target, named `openapi` or `<agent>-openapi`. */
const isOpenApiTarget = (name: string): boolean =>
  name === 'openapi' || name.endsWith('-openapi');

const arraysEqual = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

/**
 * Excludes Python test files from the `production` named input, and narrows the
 * dependent-task-output input so test reports no longer propagate downstream.
 */
const migrateNamedInputs = (tree: Tree, nextSteps: string[]): void => {
  const nxJson = readNxJson(tree);
  if (!nxJson) return;

  const production = nxJson.namedInputs?.production;
  const nextProduction = production
    ? [
        ...production,
        ...PYTHON_TEST_FILE_EXCLUSIONS.filter(
          (exclusion) => !production.includes(exclusion),
        ),
      ]
    : undefined;

  if (!production) {
    nextSteps.push(
      "nx.json declares no 'production' named input — left untouched. Add one excluding your Python test files so build tasks are not invalidated by test edits.",
    );
  }

  const defaultInput = nxJson.namedInputs?.default;
  let nextDefault = defaultInput;
  if (defaultInput) {
    const glob = DEPENDENT_TASKS_OUTPUT_FILES_INPUT.dependentTasksOutputFiles;
    // Only the entry this plugin vended is rewritten; a different glob is the
    // user's own scoping decision.
    nextDefault = defaultInput.map((input) =>
      typeof input === 'object' &&
      input !== null &&
      'dependentTasksOutputFiles' in input &&
      input.dependentTasksOutputFiles === '**/*'
        ? { ...input, dependentTasksOutputFiles: glob }
        : input,
    );
    const hadVendedEntry = nextDefault.some(
      (input) =>
        typeof input === 'object' &&
        input !== null &&
        'dependentTasksOutputFiles' in input &&
        input.dependentTasksOutputFiles === glob,
    );
    const hasCustomEntry = defaultInput.some(
      (input) =>
        typeof input === 'object' &&
        input !== null &&
        'dependentTasksOutputFiles' in input &&
        input.dependentTasksOutputFiles !== '**/*' &&
        input.dependentTasksOutputFiles !== glob,
    );
    if (!hadVendedEntry && hasCustomEntry) {
      nextSteps.push(
        `nx.json's 'default' named input scopes 'dependentTasksOutputFiles' to a custom glob — left untouched. Narrow it to '${glob}' so timestamped test reports do not invalidate downstream tasks.`,
      );
    }
  }

  updateNxJson(tree, {
    ...nxJson,
    namedInputs: {
      ...nxJson.namedInputs,
      ...(nextProduction ? { production: nextProduction } : {}),
      ...(nextDefault ? { default: nextDefault } : {}),
    },
  });
};

/**
 * Scopes a Python project's build-chain targets to production sources. Only
 * targets still carrying the inputs the generator vended are rewritten, so a
 * project whose inputs the user has tuned is reported rather than clobbered.
 */
const migrateProjectTargets = (
  tree: Tree,
  projectName: string,
  project: ProjectConfiguration,
  nextSteps: string[],
): void => {
  let changed = false;

  for (const [targetName, target] of Object.entries(project.targets ?? {})) {
    if (
      !PRODUCTION_SCOPED_TARGETS.includes(targetName) &&
      !isOpenApiTarget(targetName)
    ) {
      continue;
    }

    const inputs = target.inputs;

    // Already migrated, so a re-run is a no-op.
    if (inputs && arraysEqual(inputs as unknown[], PRODUCTION_INPUTS)) {
      continue;
    }

    // The OpenAPI targets declared no inputs at all, so they fell back to
    // `default`. Everything else carried the vended pair.
    const isVendedShape = inputs
      ? arraysEqual(inputs as unknown[], PREVIOUS_INPUTS)
      : isOpenApiTarget(targetName);

    if (!isVendedShape) {
      nextSteps.push(
        `${projectName}:${targetName}: 'inputs' has diverged from the generated shape — left untouched. Scope it to ['production', '^production'] so Python test edits do not invalidate it.`,
      );
      continue;
    }

    target.inputs = [...PRODUCTION_INPUTS];
    changed = true;
  }

  if (changed) {
    updateProjectConfiguration(tree, projectName, project);
  }
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  migrateNamedInputs(tree, nextSteps);

  for (const [projectName, project] of getProjects(tree)) {
    if (!isPythonProject(project)) continue;
    migrateProjectTargets(tree, projectName, project, nextSteps);
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
