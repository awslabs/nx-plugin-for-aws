/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  type MigrationReturnObject,
  type ProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { TS_DYNAMODB_GENERATOR_INFO } from '../../../ts/dynamodb/generator.js';
import { TS_RDB_GENERATOR_INFO } from '../../../ts/rdb/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { addDependencyToTargetIfNotPresent } from '../../../utils/nx.js';

/**
 * Make the dev target of ts#dynamodb and ts#rdb projects depend on pull-image
 *
 * Without it, `nx dev` starts the container (and, for DynamoDB, creates the
 * local table) while the image is still being fetched, so a first run on a
 * machine without the image races the pull.
 */

const GENERATOR_IDS = [TS_DYNAMODB_GENERATOR_INFO.id, TS_RDB_GENERATOR_INFO.id];

const PULL_IMAGE_TARGET = 'pull-image';

const startsGeneratedContainer = (project: ProjectConfiguration): boolean => {
  const { command, commands } = project.targets?.dev?.options ?? {};
  return [...(commands ?? []), ...(command ? [command] : [])].some(
    (c: string) => typeof c === 'string' && c.includes('start-container.ts'),
  );
};

const divergedNextStep = (projectName: string): string =>
  `${projectName}: its dev target has been customised, so it was left as it is. Add "${PULL_IMAGE_TARGET}" to the target's dependsOn so the container image is fetched before the container starts.`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];
  let migrated = false;

  for (const [name, project] of getProjects(tree)) {
    if (!GENERATOR_IDS.includes((project.metadata as any)?.generator)) {
      continue;
    }

    const dev = project.targets?.dev;
    if (!dev || !project.targets?.[PULL_IMAGE_TARGET]) {
      continue;
    }

    // Nx requires an array here. Anything else is hand-written and is reported
    // rather than rewritten, so a malformed value is never spread or clobbered.
    if (dev.dependsOn !== undefined && !Array.isArray(dev.dependsOn)) {
      nextSteps.push(divergedNextStep(name));
      continue;
    }

    const alreadyDependsOnPullImage = (dev.dependsOn ?? []).some(
      (dependency) =>
        dependency === PULL_IMAGE_TARGET ||
        (typeof dependency === 'object' &&
          dependency !== null &&
          dependency.target === PULL_IMAGE_TARGET &&
          dependency.projects === undefined),
    );
    if (alreadyDependsOnPullImage) {
      continue;
    }

    if (!startsGeneratedContainer(project)) {
      nextSteps.push(divergedNextStep(name));
      continue;
    }

    addDependencyToTargetIfNotPresent(project, 'dev', PULL_IMAGE_TARGET);
    updateProjectConfiguration(tree, name, project);
    migrated = true;
  }

  if (migrated) {
    await formatFilesInSubtree(tree);
  }

  return { nextSteps };
}
