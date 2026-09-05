/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type MigrationReturnObject,
  readJson,
  type Tree,
  updateJson,
} from '@nx/devkit';
import { applyGritQL, matchGritQL } from '../../../utils/ast.js';
import { addDependenciesToPackageJson } from '../../../utils/dependencies.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_SHADCN_DIR,
} from '../../../utils/shared-constructs-constants.js';
import { TS_VERSIONS } from '../../../utils/versions.js';

/**
 * Move the shared shadcn package onto the `cn` package.
 *
 * The shadcn registry now serves components importing `cn` from the `cn`
 * package and declares it as a registry dependency, so a component added by
 * `shadcn add` no longer resolves the package's own `#lib/utils` helper. This
 * carries an existing workspace onto that shape: the components import `cn`,
 * `src/lib/utils.ts` becomes the single-line re-export shadcn's own install
 * guide prescribes, which keeps every consumer importing `cn` through
 * `<scope>common-shadcn/lib/utils` working, and clsx / tailwind-merge are
 * dropped now that nothing imports them.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 *
 * Guardrails:
 * - Only touches a `packages/common/shadcn` this plugin's generators produced,
 *   guarded by `components.json`'s aliases still matching the generated shape.
 * - An import is only rewritten when `cn` is its sole binding, so a file also
 *   pulling a user's own helper out of `#lib/utils` keeps resolving through the
 *   re-export.
 * - `src/lib/utils.ts` is only rewritten while it still holds the generated
 *   `twMerge(clsx(...))` helper; a customised one is reported instead.
 * - clsx / tailwind-merge are only dropped once nothing under `src` imports
 *   them.
 * - Idempotent: every write is guarded by the old shape still being present.
 */

const libraryRoot = joinPathFragments(PACKAGES_DIR, SHARED_SHADCN_DIR);
const componentsJsonPath = joinPathFragments(libraryRoot, 'components.json');
const packageJsonPath = joinPathFragments(libraryRoot, 'package.json');
const srcRoot = joinPathFragments(libraryRoot, 'src');
const utilsPath = joinPathFragments(srcRoot, 'lib', 'utils.ts');

/** The aliases today's generators write, which this migration leaves in place. */
const generatedAliases: Record<string, string> = {
  components: '#components',
  utils: '#lib/utils',
  hooks: '#hooks',
  lib: '#lib',
  ui: '#components/ui',
};

const CN_IMPORT_REWRITE = `\`import { cn } from '#lib/utils'\` => \`import { cn } from 'cn'\``;

/** The generated helper, whichever way the user's formatter has laid it out. */
const GENERATED_CN_HELPER = `\`twMerge(clsx($_))\``;

const importsPackage = (name: string): string => `\`import $_ from '${name}'\``;

const REEXPORT_UTILS = `export { cn } from 'cn';\n`;

const DROPPED_PACKAGES = ['clsx', 'tailwind-merge'] as const;

/** Every `.ts`/`.tsx` file in the package's source tree. */
const sourceFiles = (tree: Tree, dir: string): string[] => {
  if (!tree.exists(dir)) {
    return [];
  }
  return tree.children(dir).flatMap((entry) => {
    const path = joinPathFragments(dir, entry);
    if (!tree.isFile(path)) {
      return sourceFiles(tree, path);
    }
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : [];
  });
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  if (!tree.exists(componentsJsonPath) || !tree.exists(packageJsonPath)) {
    return { nextSteps };
  }

  const aliases =
    readJson<{ aliases?: Record<string, string> }>(tree, componentsJsonPath)
      .aliases ?? {};
  if (Object.entries(generatedAliases).some(([k, v]) => aliases[k] !== v)) {
    return { nextSteps };
  }

  const files = sourceFiles(tree, srcRoot);

  for (const file of files) {
    await applyGritQL(tree, file, CN_IMPORT_REWRITE);
  }

  if (tree.exists(utilsPath)) {
    if (await matchGritQL(tree, utilsPath, GENERATED_CN_HELPER)) {
      tree.write(utilsPath, REEXPORT_UTILS);
    } else if (tree.read(utilsPath, 'utf-8') !== REEXPORT_UTILS) {
      nextSteps.push(
        `${utilsPath}: no longer holds the generated cn helper - left untouched. Re-export cn from the 'cn' package by hand so consumers importing it from here keep working.`,
      );
    }
  }

  addDependenciesToPackageJson(
    tree,
    { cn: TS_VERSIONS.cn },
    {},
    packageJsonPath,
  );

  const stillImported = new Set<string>();
  for (const file of sourceFiles(tree, srcRoot)) {
    for (const name of DROPPED_PACKAGES) {
      if (await matchGritQL(tree, file, importsPackage(name))) {
        stillImported.add(name);
      }
    }
  }

  updateJson(tree, packageJsonPath, (json) => {
    for (const name of DROPPED_PACKAGES) {
      if (!stillImported.has(name)) {
        delete json.dependencies?.[name];
        delete json.devDependencies?.[name];
      }
    }
    return json;
  });

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
