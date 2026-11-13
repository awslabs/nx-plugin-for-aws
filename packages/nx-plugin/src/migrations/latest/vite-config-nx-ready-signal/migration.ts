/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { REACT_WEBSITE_APP_GENERATOR_INFO } from '../../../ts/react-website/app/generator.js';
import { applyGritQL, matchGritQL } from '../../../utils/ast.js';
import { formatFilesWithBiome } from '../../../utils/format.js';

/** The module Nx 24 vends the ready-signal Vite plugin from. */
const READY_SIGNAL_MODULE = '@nx/vite/plugins/nx-ready-signal.plugin';

/** The `@vitejs/plugin-react` default import every vended website has. */
const REACT_IMPORT = "`import react from '@vitejs/plugin-react'`";

/** A `plugins` array of the config passed to `defineConfig`. */
const PLUGINS_ARRAY =
  '`plugins: [$items]` where { $items <: within `defineConfig($_)`';

/**
 * Nx 24's `@nx/vite:update-24-0-0-add-ready-signal-plugin` migration appends
 * `nxReadySignal()` to the `plugins` of every application's Vite config and
 * formats with Prettier, which these workspaces don't use. A react-website
 * config, whose `plugins` array is already split over several lines, then holds
 * `tailwindcss(), nxReadySignal(),` on one line, and the vended `format` target
 * (`biome format`) fails the build.
 *
 * `nx migrate` sorts migrations by their version across packages, so this
 * plugin's migrations (1.x) run before Nx's (24.x). This adds the import and
 * `nxReadySignal()` after `react()`, as new websites get them, and formats the
 * file. Nx's migration skips any config that already mentions `nxReadySignal`.
 *
 * When Nx's migration ran in an earlier `nx migrate`, the plugin is already
 * there and the file is only formatted. A config whose plugins no longer match
 * the generated shape is left as it is.
 */
export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];
  // Configs to format: only these, so no other file in the workspace changes.
  const toFormat: string[] = [];

  const websites = [...getProjects(tree).entries()].filter(
    ([, project]) =>
      (project.metadata as { generator?: string } | undefined)?.generator ===
      REACT_WEBSITE_APP_GENERATOR_INFO.id,
  );

  for (const [name, website] of websites) {
    const viteConfigPath = joinPathFragments(website.root, 'vite.config.mts');
    const content = tree.read(viteConfigPath, 'utf-8');
    if (content === null) {
      continue;
    }

    // Already loaded, by an earlier run of Nx's migration or by hand: Nx
    // formats what it adds with Prettier, so format it with Biome. The same
    // check Nx's migration makes before it edits a config.
    if (
      content.includes('nxReadySignal') ||
      content.includes('nx-ready-signal')
    ) {
      toFormat.push(viteConfigPath);
      continue;
    }

    const matchesGeneratedShape =
      (await matchGritQL(tree, viteConfigPath, REACT_IMPORT)) &&
      (await matchGritQL(
        tree,
        viteConfigPath,
        `${PLUGINS_ARRAY}, $items <: some \`react()\` }`,
      ));
    if (!matchesGeneratedShape) {
      nextSteps.push(
        `${viteConfigPath}: its plugins differ from the ones the react-website generator writes, so nxReadySignal() was not added. If Nx's own migration adds it on the line of another plugin, run \`nx run ${name}:format --configuration=fix\` to format the file.`,
      );
      continue;
    }

    await applyGritQL(
      tree,
      viteConfigPath,
      `${PLUGINS_ARRAY}, $items <: some bubble $plugin where { $plugin <: \`react()\`, $plugin += \`, nxReadySignal()\` } }`,
    );
    await applyGritQL(
      tree,
      viteConfigPath,
      `${REACT_IMPORT} as $import where { $import += \`\nimport { nxReadySignal } from '${READY_SIGNAL_MODULE}';\` }`,
    );
    toFormat.push(viteConfigPath);
  }

  formatFilesWithBiome(tree, toFormat);

  return { nextSteps };
}
