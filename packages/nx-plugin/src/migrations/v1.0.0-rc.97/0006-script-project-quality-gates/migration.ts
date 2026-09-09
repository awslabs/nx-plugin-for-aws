/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { AGENTCORE_GATEWAY_GENERATOR_INFO } from '../../../agentcore-gateway/generator.js';
import { AGENTCORE_HARNESS_GENERATOR_INFO } from '../../../agentcore-harness/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { addScriptProjectTargets } from '../../../utils/script-project-targets.js';

/**
 * AgentCore Gateway and Harness projects host TypeScript that runs through
 * `tsx` — a Gateway's `local-dev.ts` (which the connection generators edit) and
 * a Harness's `scripts/chat.ts`. Neither project had a `tsconfig.json` or a
 * `build`, `lint`, `format` or `typecheck` target, so that code was invisible to
 * `nx run-many --target build --all` and a type error in it only surfaced at
 * runtime.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 */

/** The generators whose projects gain the gates. */
const SCRIPT_PROJECT_GENERATORS = [
  AGENTCORE_GATEWAY_GENERATOR_INFO.id,
  AGENTCORE_HARNESS_GENERATOR_INFO.id,
];

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [, project] of getProjects(tree)) {
    const generator = (project.metadata as { generator?: string } | undefined)
      ?.generator;
    if (!generator || !SCRIPT_PROJECT_GENERATORS.includes(generator)) {
      continue;
    }
    // Already migrated (or the user added their own gates).
    if (project.targets?.typecheck) {
      continue;
    }
    // A project that has been reworked into a compiled `ts#project` owns its own
    // tsconfig graph, so leave it alone rather than layering a `noEmit` config on
    // top of one that emits.
    if (tree.exists(joinPathFragments(project.root, 'tsconfig.lib.json'))) {
      nextSteps.push(
        `Project '${project.name}' has a tsconfig.lib.json, so its quality gates were left as they are. Confirm its build covers the TypeScript at ${project.root}.`,
      );
      continue;
    }

    addScriptProjectTargets(tree, { project });
    updateProjectConfiguration(tree, project.name, project);
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
