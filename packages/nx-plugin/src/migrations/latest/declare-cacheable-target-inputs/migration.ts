/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  type MigrationReturnObject,
  type TargetConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * A cacheable target declaring no `inputs` gets Nx's implicit
 * `["default", "^default"]`, which reads a dependency's whole project directory
 * — its README, its dev scripts, everything. That is wider than the explicit
 * inputs its siblings carry, so editing a dependency's README re-ran targets
 * whose output could not possibly change.
 *
 * Which explicit inputs are right depends on whether the target has a
 * `dependsOn`. `default` carries a transitive `dependentTasksOutputFiles` entry,
 * which Nx resolves against the task's upstream tasks — so a target with an
 * upstream task still hashes the dependency output it consumes through it, and
 * `["default"]` is enough. A target with no `dependsOn` has nothing for that
 * entry to resolve against, so `default` collapses to the project's own files
 * and dropping `^default` would remove the last edge to the dependency. Those
 * keep a dependency input: `["default", "^production"]`.
 */

/** Targets whose `dependsOn` keeps the dependency edge inside `default`. */
const DEFAULT_ONLY_NAMES = [
  'bundle',
  'bundle-migration',
  'bundle-create-db-user',
  'operations',
];

/**
 * Suffix of the OpenAPI spec targets, which carry a per-agent prefix
 * (`my-agent-openapi`) on a project hosting more than one.
 *
 * These have no `dependsOn`, and their spec serialises models a dependency may
 * own, so they keep a dependency input — without it a dependency's model change
 * serves a stale spec, and that spec feeds client generation.
 */
const OPENAPI_SUFFIX = 'openapi';

const CHECKOV_TARGET = 'checkov';

/**
 * Inputs for a target with no upstream task to resolve `default`'s transitive
 * `dependentTasksOutputFiles` against. `^production` rather than `^default` so a
 * dependency's test edits still do not invalidate it.
 */
const WITH_DEPENDENCY_INPUTS = ['default', '^production'];

/** Whether a target is one of the ones narrowed to `["default"]`. */
const isDefaultOnlyTarget = (name: string): boolean =>
  DEFAULT_ONLY_NAMES.includes(name);

/** Whether a target is an OpenAPI spec target, which has no `dependsOn`. */
const isOpenApiTarget = (name: string): boolean =>
  name === OPENAPI_SUFFIX || name.endsWith(`-${OPENAPI_SUFFIX}`);

/**
 * Whether a target still looks like the one the generators produced: a
 * run-commands target declaring where it writes. A target with no declared
 * outputs is not one of ours, and is the user's to scope since only they know
 * what it reads.
 *
 * The location is not checked. `operations` writes generated Terraform sources
 * under `packages/common/terraform/src/generated/`, not `dist`, so requiring
 * `dist` would mean this migration could never match a real one.
 */
const matchesVendedShape = (target: TargetConfiguration): boolean =>
  target.executor === 'nx:run-commands' &&
  Array.isArray(target.outputs) &&
  target.outputs.length > 0 &&
  target.outputs.every((output) => typeof output === 'string');

/** The inputs a target should declare, or undefined to leave it alone. */
const inputsFor = (
  name: string,
  target: TargetConfiguration,
): string[] | undefined => {
  // Only a cacheable target with no inputs at all falls back to Nx's implicit
  // ones, so one already declaring inputs is left as it is — which also makes
  // re-running this a no-op.
  if (!target.cache || target.inputs) return undefined;
  if (!matchesVendedShape(target)) return undefined;
  // `checkov` resolves the relative Terraform modules a project consumes, so it
  // keeps a dependency edge rather than dropping one.
  if (name === CHECKOV_TARGET || isOpenApiTarget(name)) {
    return WITH_DEPENDENCY_INPUTS;
  }
  return isDefaultOnlyTarget(name) ? ['default'] : undefined;
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    let changed = false;

    for (const [name, target] of Object.entries(project.targets ?? {})) {
      const inputs = inputsFor(name, target);
      if (!inputs) continue;

      project.targets[name] = { ...target, inputs };
      changed = true;
    }

    if (changed) {
      updateProjectConfiguration(tree, projectName, project);
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
