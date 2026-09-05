/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  type MigrationReturnObject,
  type ProjectConfiguration,
  type TargetConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { IMAGE_BUILD_CACHE } from '../../../utils/docker.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * Stop Nx caching the targets that build and scan container images.
 *
 * A built image lives in the container engine's store, not under any `outputs`
 * path, so there was nothing for Nx to restore on a cache hit: `build` reported
 * success for an image the engine no longer had, and the `trivy` target that
 * depends on it reported a cached pass against that missing image — so a stale
 * or absent image could clear both a build and a vulnerability scan.
 *
 * The container engine's layer cache already makes the rebuild cheap and, unlike
 * Nx's, it cannot claim a hit for an image that isn't there.
 *
 * A target named as one of these but no longer running the engine has been
 * reworked by the user, so it is left untouched and reported via `nextSteps`.
 */

/** Names the generators give the targets that build or scan an image. */
const IMAGE_TARGET_NAME = /(^|-)(docker|trivy)$/;

/** Commands that build an image, or read one back out of the engine to scan it. */
const CONTAINER_ENGINE_COMMAND = /\b(docker|finch)\s+(build|save)\b/;

/**
 * The `Dockerfile` the TypeScript image targets declared as their output. It is
 * a copy made on the way into the build context, never a product of the build,
 * so it is dropped along with the caching it existed to support.
 */
const VENDED_DOCKERFILE_OUTPUT = /\/bundle\/(agent|mcp)\/[^/]+\/Dockerfile$/;

/** The directory the scan target stages its tarball and ignore file in. */
const VENDED_SCAN_OUTPUT = /\/trivy\/[^/]+$/;

/**
 * Outputs the generators declare on these targets. Neither is the artifact the
 * target's success stands for, so dropping their caching loses nothing. An
 * output beyond these belongs to a target the user has repurposed, whose product
 * may genuinely be on disk and soundly cacheable.
 */
const isVendedOutput = (output: string): boolean =>
  VENDED_DOCKERFILE_OUTPUT.test(output) || VENDED_SCAN_OUTPUT.test(output);

/** Every command a target runs, however its options spell them. */
const targetCommands = (target: TargetConfiguration): string[] => {
  const { command, commands } = (target.options ?? {}) as {
    command?: unknown;
    commands?: unknown;
  };
  return [
    ...(typeof command === 'string' ? [command] : []),
    ...(Array.isArray(commands) ? commands : []),
  ].filter((c): c is string => typeof c === 'string');
};

const divergedMessage = (projectName: string, targetName: string) =>
  `${projectName}:${targetName}: has diverged from the generated shape - left untouched. Set \`"cache": false\` on it by hand if it builds or scans a container image: the image lives in the container engine rather than under the target's \`outputs\`, so a cache hit can report success for an image that is no longer there.`;

const ownOutputsMessage = (projectName: string, targetName: string) =>
  `${projectName}:${targetName}: declares outputs of its own, so it was left cacheable. If its result depends on a container image rather than only on those outputs, set \`"cache": false\` on it by hand: the image lives in the container engine, so a cache hit can report success for an image that is no longer there.`;

/** Applies the fix to one target, reporting one it declines to touch. */
const migrateTarget = (
  projectName: string,
  targetName: string,
  target: TargetConfiguration,
  nextSteps: string[],
): boolean => {
  // A target with `cache` unset is not cached unless `targetDefaults` opts it
  // in, and one already set to false is sound, so only an explicitly cacheable
  // one needs rewriting. Both leave a re-run a no-op.
  if (target.cache !== true) return false;

  if (!targetCommands(target).some((c) => CONTAINER_ENGINE_COMMAND.test(c))) {
    nextSteps.push(divergedMessage(projectName, targetName));
    return false;
  }

  // Running the engine does not by itself make a target's result uncacheable:
  // one that also declares outputs of its own may well produce the artifact its
  // success stands for on disk (a `docker save` tarball, a test report), and
  // that is soundly cacheable. Only the shapes the generators vend are rewritten.
  const ownOutputs = target.outputs?.filter((o) => !isVendedOutput(o)) ?? [];
  if (ownOutputs.length > 0) {
    nextSteps.push(ownOutputsMessage(projectName, targetName));
    return false;
  }

  target.cache = IMAGE_BUILD_CACHE;

  // The scan keeps its staging directory: it is a real directory on disk, and
  // dropping it would leave the tarball behind on a later run.
  const outputs = target.outputs?.filter(
    (o) => !VENDED_DOCKERFILE_OUTPUT.test(o),
  );
  if (outputs && outputs.length === 0) {
    delete target.outputs;
  } else if (outputs) {
    target.outputs = outputs;
  }

  return true;
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    let changed = false;

    for (const [targetName, target] of Object.entries(project.targets ?? {})) {
      // Matched on the name so a target reworked to no longer run the engine is
      // still found and reported, rather than silently left cacheable.
      if (!IMAGE_TARGET_NAME.test(targetName)) continue;

      changed =
        migrateTarget(projectName, targetName, target, nextSteps) || changed;
    }

    if (changed) {
      updateProjectConfiguration(
        tree,
        projectName,
        project as ProjectConfiguration,
      );
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
