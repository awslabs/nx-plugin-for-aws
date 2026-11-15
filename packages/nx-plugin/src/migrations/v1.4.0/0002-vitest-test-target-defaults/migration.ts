/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type NxJsonConfiguration,
  readNxJson,
  type Tree,
  updateNxJson,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  isVitestPluginEntry,
  VITEST_PLUGIN,
  withVitestTestTargetDefaults,
} from './vitest-target-defaults.js';

/** The nx.json `targetDefaults` key of the executor Nx 24 removed. */
const LEGACY_KEY = '@nx/vitest:test';

/** The config files whose presence makes ts#project configure vitest. */
const VITEST_CONFIG_FILES = ['vitest.config.mts', 'vite.config.mts'];

/** Whether nx.json registers the {@link VITEST_PLUGIN} inference plugin. */
const registersVitestPlugin = (nxJson: NxJsonConfiguration): boolean =>
  (nxJson.plugins ?? []).some(
    (plugin) =>
      (typeof plugin === 'string' ? plugin : plugin.plugin) === VITEST_PLUGIN,
  );

/** Whether any project has a vitest config file at its root. */
const hasVitestProject = (tree: Tree): boolean =>
  [...getProjects(tree).values()].some(({ root }) =>
    VITEST_CONFIG_FILES.some((file) =>
      tree.exists(joinPathFragments(root, file)),
    ),
  );

/**
 * Workspaces generated before Nx 24 hold the vitest test defaults (caching,
 * inputs and the `update-snapshot` configuration) under
 * `targetDefaults['@nx/vitest:test']`. Nx 24 removed that executor, so the key
 * matches no target and `nx test <project> -c update-snapshot` stops updating
 * snapshots. This removes the key and writes its values onto the
 * `targetDefaults.test` entry filtered to the `@nx/vitest` plugin, the entry
 * the generators write today. Values already in that entry win.
 *
 * The array form of the key (filtered entries) cannot be moved without
 * guessing how its filters combine with the plugin filter, so it is left as it
 * is and reported.
 *
 * When `nx migrate 24.x` ran before this plugin was upgraded, Nx's own
 * `@nx/vitest` migration has already deleted the key and its values. The
 * vended defaults are then added if the workspace registers the `@nx/vitest`
 * plugin and has a project with a vitest config, unless a filtered
 * `@nx/vitest` entry already exists, which is left exactly as it is.
 */
export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  const nxJson = readNxJson(tree);
  if (!nxJson) {
    return { nextSteps };
  }
  const legacy = nxJson.targetDefaults?.[LEGACY_KEY];
  if (legacy === undefined) {
    const hasVitestEntry = [nxJson.targetDefaults?.test ?? []]
      .flat()
      .some(isVitestPluginEntry);
    if (
      !hasVitestEntry &&
      registersVitestPlugin(nxJson) &&
      hasVitestProject(tree)
    ) {
      updateNxJson(tree, {
        ...nxJson,
        targetDefaults: withVitestTestTargetDefaults(nxJson.targetDefaults),
      });
      await formatFilesInSubtree(tree);
    }
    return { nextSteps };
  }
  if (Array.isArray(legacy)) {
    nextSteps.push(
      `nx.json targetDefaults['${LEGACY_KEY}'] no longer applies: Nx 24 removed that executor. Move its entries into targetDefaults.test, add "plugin": "@nx/vitest" to each entry's filter, then delete the '${LEGACY_KEY}' key.`,
    );
    return { nextSteps };
  }

  const { [LEGACY_KEY]: _removed, ...targetDefaults } = nxJson.targetDefaults;
  updateNxJson(tree, {
    ...nxJson,
    targetDefaults: withVitestTestTargetDefaults(targetDefaults, legacy),
  });

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
