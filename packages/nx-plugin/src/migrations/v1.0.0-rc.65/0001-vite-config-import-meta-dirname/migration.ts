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
import { applyGritQL } from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';

/**
 * Resolve the vended vite and vitest config paths from `import.meta.dirname`
 * rather than `__dirname`.
 *
 * `__dirname` is unavailable to Vite's native config loader, so every generated
 * TypeScript project's config warned that it "uses features that are unsupported
 * by `configLoader: 'native'`". That loader is slated to become the default, at
 * which point the config breaks rather than warns.
 *
 * Two shapes are rewritten: the `root` that `@nx/js` writes into every project's
 * config, and the two paths `ts#react-website` passes to the TanStack Router
 * plugin.
 *
 * Guardrails:
 * - Every pattern is anchored to the exact shape the generators produce, and
 *   scoped with `some` so it only matches a direct property of the object it
 *   names. A `root` nested inside another option, or a `resolve(__dirname, ...)`
 *   the user wrote anywhere else in the config, is left alone.
 * - The router paths are matched by option name *and* path literal, so a user who
 *   pointed one somewhere else keeps their value.
 * - Idempotent: no pattern matches once rewritten.
 */

/**
 * The `root` of the object the config factory returns. `some` matches a direct
 * property only, so a nested `root` (a `test.alias` entry, say) is not touched.
 */
const ROOT_PATTERN = `\`defineConfig(() => ({ $props }))\` where {
  $props <: some \`root: __dirname\` as $root,
  $root => \`root: import.meta.dirname\`
}`;

/**
 * One of the TanStack Router plugin's path options, matched by name and by the
 * path the generator passes — so a user who repointed it keeps their value.
 * Scoped to the plugin's own option object rather than the file, so a
 * `resolve(__dirname, ...)` elsewhere in the config is left alone.
 */
const routerPathPattern = (option: string, path: string): string =>
  `\`tanstackRouter({ $opts })\` where {
     $opts <: some \`${option}: resolve(__dirname, '${path}')\` as $path,
     $path => \`${option}: resolve(import.meta.dirname, '${path}')\`
   }`;

/** The paths `ts#react-website` gives the TanStack Router plugin. */
const ROUTER_PATTERNS = [
  routerPathPattern('routesDirectory', 'src/routes'),
  routerPathPattern('generatedRouteTree', 'src/routeTree.gen.ts'),
];

/** The config filenames a generated project may carry. */
const CONFIG_FILES = ['vitest.config.mts', 'vite.config.mts'];

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  for (const project of getProjects(tree).values()) {
    for (const configFile of CONFIG_FILES) {
      const configPath = joinPathFragments(project.root, configFile);
      if (!tree.exists(configPath)) {
        continue;
      }
      for (const pattern of [ROOT_PATTERN, ...ROUTER_PATTERNS]) {
        await applyGritQL(tree, configPath, pattern);
      }
    }
  }

  await formatFilesInSubtree(tree);

  return {};
}
