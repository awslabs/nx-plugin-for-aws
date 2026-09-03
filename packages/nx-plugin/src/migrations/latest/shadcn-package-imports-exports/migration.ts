/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  readJson,
  type Tree,
  updateJson,
} from '@nx/devkit';
import { REACT_WEBSITE_APP_GENERATOR_INFO } from '../../../ts/react-website/app/generator.js';
import { applyGritQL, matchGritQL } from '../../../utils/ast.js';
import {
  addDependenciesToPackageJson,
  getLocalDependencySpecifier,
} from '../../../utils/dependencies.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_SHADCN_DIR,
} from '../../../utils/shared-constructs-constants.js';
import { getSharedShadcnFullyQualifiedName } from '../../../utils/shared-shadcn.js';

/**
 * Move the shared shadcn package off a `tsconfig.base.json` `paths` alias onto
 * `package.json` `imports`/`exports`.
 *
 * shadcn 4.x's CLI resolves `components.json`'s aliases via Node's package
 * resolution (`imports`/`exports`), not tsconfig `paths` - its own resolver
 * naively joins a tsconfig-declared alias against whichever directory it's
 * invoked from, so the repo-root-relative `paths` mapping this plugin used to
 * vend breaks the moment `shadcn add` is run with `-c packages/common/shadcn`
 * (as its own monorepo-root preflight now tells the user to). This migration
 * carries an existing workspace onto the shape today's generators produce:
 * local `#...` imports for the package's own internal component references,
 * a public `exports` map for every other consumer, and a real `workspace:*`
 * dependency on each consumer so that map actually resolves.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 *
 * Guardrails:
 * - Only touches a `packages/common/shadcn` this plugin's generators produced
 *   (guarded by `components.json`'s aliases still matching the old shape).
 * - Internal imports are rewritten by exact module specifier per file found
 *   under `src/{components/ui,lib,hooks}`, so a component a user added by hand
 *   after the original generation is covered too, and a specifier the
 *   migration doesn't recognise is left alone and reported.
 * - Idempotent: every write is guarded by the old shape still being present.
 */

const libraryRoot = joinPathFragments(PACKAGES_DIR, SHARED_SHADCN_DIR);
const componentsJsonPath = joinPathFragments(libraryRoot, 'components.json');
const packageJsonPath = joinPathFragments(libraryRoot, 'package.json');

interface ComponentsJsonAliases {
  readonly components?: string;
  readonly utils?: string;
  readonly hooks?: string;
  readonly lib?: string;
  readonly ui?: string;
}

const oldAliases = (fqn: string): ComponentsJsonAliases => ({
  components: `${fqn}/components`,
  utils: `${fqn}/lib/utils`,
  hooks: `${fqn}/hooks`,
  lib: `${fqn}/lib`,
  ui: `${fqn}/components/ui`,
});

const newAliases: Required<ComponentsJsonAliases> = {
  components: '#components',
  utils: '#lib/utils',
  hooks: '#hooks',
  lib: '#lib',
  ui: '#components/ui',
};

const newPackageManifestFields = {
  imports: {
    '#components/*': './src/components/*.tsx',
    '#lib/*': './src/lib/*.ts',
    '#hooks/*': './src/hooks/*.ts',
  },
  exports: {
    '.': './src/index.ts',
    './styles/*': './src/styles/*',
    './components/*': './src/components/*.tsx',
    './lib/*': './src/lib/*.ts',
    './hooks/*': './src/hooks/*.ts',
  },
};

/**
 * Rewrite an import's module specifier, keeping its bindings - `$bindings`
 * holds whatever the file imports, so a binding a user added survives.
 */
const importPattern = (from: string, to: string): string =>
  `\`import { $bindings } from '${from}'\` => \`import { $bindings } from '${to}'\``;

/** Whether the file still imports the old specifier under any other form. */
const hasRemainingImport = (from: string): string =>
  `\`import $_ from '${from}'\``;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  if (!tree.exists(componentsJsonPath) || !tree.exists(packageJsonPath)) {
    return { nextSteps };
  }

  const fullyQualifiedName = getSharedShadcnFullyQualifiedName(tree);
  const currentAliases =
    readJson<{ aliases?: ComponentsJsonAliases }>(tree, componentsJsonPath)
      .aliases ?? {};
  const expectedOldAliases = oldAliases(fullyQualifiedName);
  const onOldShape = (
    Object.keys(newAliases) as (keyof ComponentsJsonAliases)[]
  ).every((key) => currentAliases[key] === expectedOldAliases[key]);

  if (!onOldShape) {
    if (
      (Object.keys(newAliases) as (keyof ComponentsJsonAliases)[]).some(
        (key) => currentAliases[key] !== newAliases[key],
      )
    ) {
      nextSteps.push(
        `${componentsJsonPath}: aliases have diverged from both the old and current generated shape - left untouched. Migrate them to the shadcn CLI's imports/exports monorepo pattern by hand: https://ui.shadcn.com/docs/monorepo`,
      );
    }
    await formatFilesInSubtree(tree);
    return { nextSteps };
  }

  // Rewrite every source file's internal references to this package's own
  // components/lib/hooks, keyed off the files actually present so a
  // hand-added component is covered too.
  const internalDirs: Array<{
    dir: string;
    extension: string;
    oldSubpath: string;
    newPrefix: string;
  }> = [
    {
      dir: joinPathFragments(libraryRoot, 'src', 'components', 'ui'),
      extension: '.tsx',
      oldSubpath: 'components/ui',
      newPrefix: '#components/ui',
    },
    {
      dir: joinPathFragments(libraryRoot, 'src', 'lib'),
      extension: '.ts',
      oldSubpath: 'lib',
      newPrefix: '#lib',
    },
    {
      dir: joinPathFragments(libraryRoot, 'src', 'hooks'),
      extension: '.ts',
      oldSubpath: 'hooks',
      newPrefix: '#hooks',
    },
  ];

  const renames: Array<{ old: string; renamed: string }> = [];
  const sourceFiles: string[] = [];
  for (const { dir, extension, oldSubpath, newPrefix } of internalDirs) {
    if (!tree.exists(dir)) {
      continue;
    }
    for (const entry of tree.children(dir)) {
      if (!entry.endsWith(extension)) {
        continue;
      }
      const baseName = entry.slice(0, -extension.length);
      renames.push({
        old: `${fullyQualifiedName}/${oldSubpath}/${baseName}`,
        renamed: `${newPrefix}/${baseName}`,
      });
      sourceFiles.push(joinPathFragments(dir, entry));
    }
  }

  for (const sourceFile of sourceFiles) {
    for (const { old, renamed } of renames) {
      await applyGritQL(tree, sourceFile, importPattern(old, renamed));
      // A namespace or default import of the same specifier is left as it
      // is - reported rather than rewritten, so a diverged file is never
      // clobbered.
      if (await matchGritQL(tree, sourceFile, hasRemainingImport(old))) {
        nextSteps.push(
          `${sourceFile}: still imports '${old}' in a form this migration does not rewrite - update it to '${renamed}' by hand.`,
        );
      }
    }
  }

  updateJson(tree, componentsJsonPath, (json) => ({
    ...json,
    aliases: newAliases,
  }));

  updateJson(tree, packageJsonPath, (json) => ({
    ...json,
    ...newPackageManifestFields,
  }));

  updateJson(tree, 'tsconfig.base.json', (json) => {
    const paths = { ...(json.compilerOptions?.paths ?? {}) };
    delete paths[`${fullyQualifiedName}/*`];
    return {
      ...json,
      compilerOptions: {
        ...json.compilerOptions,
        paths,
      },
    };
  });

  // Every website generated with ux=shadcn needs a real dependency on the
  // shared package now that it resolves through `exports`, not `paths`.
  for (const project of getProjects(tree).values()) {
    const metadata = project.metadata as
      | { generator?: string; ux?: string }
      | undefined;
    if (
      metadata?.generator !== REACT_WEBSITE_APP_GENERATOR_INFO.id ||
      metadata.ux !== 'shadcn'
    ) {
      continue;
    }
    addDependenciesToPackageJson(
      tree,
      { [fullyQualifiedName]: getLocalDependencySpecifier(tree) },
      {},
      joinPathFragments(project.root, 'package.json'),
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
