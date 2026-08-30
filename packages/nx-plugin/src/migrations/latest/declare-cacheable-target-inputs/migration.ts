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
 * `["default"]` its siblings carry, so editing a dependency's README re-ran
 * targets whose output could not possibly change.
 *
 * These targets consume a dependency only through the build artifacts `default`
 * already tracks, so `^default` added nothing but false invalidations.
 *
 * `checkov` is the exception: it resolves the relative Terraform modules a
 * project consumes, so it narrows to `["default", "^production"]` — matching the
 * `test` target beside it — rather than dropping the dependency edge entirely.
 */

/** Target names narrowed to `["default"]`. */
const DEFAULT_ONLY_NAMES = [
  'bundle',
  'bundle-migration',
  'bundle-create-db-user',
  'operations',
];

/**
 * Suffix of the OpenAPI spec targets, which carry a per-agent prefix
 * (`my-agent-openapi`) on a project hosting more than one.
 */
const OPENAPI_SUFFIX = 'openapi';

const CHECKOV_TARGET = 'checkov';
const CHECKOV_INPUTS = ['default', '^production'];

/** Whether a target is one of the ones narrowed to `["default"]`. */
const isDefaultOnlyTarget = (name: string): boolean =>
  DEFAULT_ONLY_NAMES.includes(name) ||
  name === OPENAPI_SUFFIX ||
  name.endsWith(`-${OPENAPI_SUFFIX}`);

/**
 * Whether a target still looks like the one the generators produced: a
 * run-commands target writing into `dist`. A target that has been pointed
 * somewhere else is the user's to scope, since only they know what it reads.
 */
const matchesVendedShape = (target: TargetConfiguration): boolean =>
  target.executor === 'nx:run-commands' &&
  Array.isArray(target.outputs) &&
  target.outputs.length > 0 &&
  target.outputs.every(
    (output) => typeof output === 'string' && output.includes('/dist/'),
  );

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
  if (name === CHECKOV_TARGET) return CHECKOV_INPUTS;
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
