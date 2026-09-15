/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type ProjectConfiguration,
  type Tree,
  writeJson,
} from '@nx/devkit';
import { biomeTargets, registerBiomeNamedInput } from '../ts/lib/biome.js';
import { normalizeTargetKeyOrder } from './nx.js';
import { sortObjectKeys } from './object.js';
import { getRelativePathToRootByDirectory } from './paths.js';

/**
 * Config a script-only project is type-checked against. It runs through `tsx`
 * and emits nothing, so it opts out of the emit options the workspace's
 * `tsconfig.base.json` sets for project references.
 */
const SCRIPT_TSCONFIG_FILE_NAME = 'tsconfig.json';

export interface AddScriptProjectTargetsOptions {
  /** Project configuration to add the targets to (mutated in place). */
  readonly project: ProjectConfiguration;
  /** Additional `tsconfig.json` `types` entries beyond `node`. */
  readonly types?: readonly string[];
}

/**
 * Give a script-only TypeScript project the same targets a `ts#project` gets,
 * so its vended TypeScript is covered by `nx run-many --target build --all`.
 *
 * Writes a `noEmit` `tsconfig.json` (kept if the user already has one) and adds
 * `typecheck` alongside the shared Biome `lint`/`format` targets and a `build`
 * that runs them. `compile` is deliberately absent: these projects run through
 * `tsx`, so there is no build artifact to produce.
 *
 * The tsconfig is not registered as a workspace project reference — a `noEmit`
 * project produces no declarations for another project to consume, and Nx's
 * `@nx/js/typescript` plugin disables an inferred `typecheck` for any project
 * reachable from one.
 */
export const addScriptProjectTargets = (
  tree: Tree,
  options: AddScriptProjectTargetsOptions,
): void => {
  const { project, types = [] } = options;
  const tsConfigPath = joinPathFragments(
    project.root,
    SCRIPT_TSCONFIG_FILE_NAME,
  );

  if (!tree.exists(tsConfigPath)) {
    writeJson(tree, tsConfigPath, {
      extends: joinPathFragments(
        getRelativePathToRootByDirectory(project.root),
        'tsconfig.base.json',
      ),
      compilerOptions: {
        composite: false,
        declarationMap: false,
        emitDeclarationOnly: false,
        noEmit: true,
        types: ['node', ...types],
      },
      include: ['**/*.ts'],
    });
  }

  project.targets ??= {};
  project.targets = sortObjectKeys({
    ...project.targets,
    ...biomeTargets(tree),
    typecheck: normalizeTargetKeyOrder({
      executor: 'nx:run-commands',
      cache: true,
      inputs: ['default', '^default'],
      options: {
        command: `tsc --noEmit -p ${SCRIPT_TSCONFIG_FILE_NAME}`,
        cwd: '{projectRoot}',
      },
    }),
    build: normalizeTargetKeyOrder({
      ...project.targets.build,
      dependsOn: ['lint', 'typecheck'],
    }),
  });

  registerBiomeNamedInput(tree);
};
