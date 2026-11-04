/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getDependencyVersionFromPackageJson,
  type MigrationReturnObject,
  readJson,
  type Tree,
  writeJson,
} from '@nx/devkit';
import { gte, minVersion, validRange } from 'semver';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { ownedDependencies } from '../../../utils/version-upgrade-migration/owned-dependencies.js';
import { syncedTsVersion } from '../../../utils/version-upgrade-migration/sync-vended-versions.js';

/**
 * Turn off Biome's Markdown and YAML formatting in `biome.json`.
 *
 * Biome 2.6 formats Markdown and YAML by default. The vended `format` target
 * runs `biome format {projectRoot}`, so after the upgrade it fails on generated
 * README.md files and the TypeScript Greengrass component's `recipe.yaml`, and
 * `lint` and `build` stop with it.
 *
 * Guardrails:
 * - A workspace without `biome.json` is left alone.
 * - A top-level `markdown` or `yaml` key that is already present is the user's
 *   own setting and is kept as it is. Biome 2.5 rejects both keys, so one is
 *   only present when the user configured Biome 2.6 themselves.
 * - Missing keys go right after `css`, where the generators place them, or at
 *   the end when there is no `css` section.
 * - Idempotent: a second run finds both keys present and changes nothing.
 * - Biome 2.5 rejects both keys and then fails every `format` and `lint`
 *   target, so they are added only when the workspace runs Biome 2.6 or later
 *   once `nx migrate` finishes. Otherwise `biome.json` is left as it is and a
 *   next step says what to add after moving to Biome 2.6.
 */

const BIOME_CONFIG = 'biome.json';

const LANGUAGES = ['markdown', 'yaml'] as const;

const FORMATTER_OFF = { formatter: { enabled: false } };

const BIOME = '@biomejs/biome';

/** First Biome release that accepts the `markdown` and `yaml` keys. */
const MIN_BIOME_VERSION = '2.6.0';

/** Whether every version a semver range allows is Biome 2.6 or later. */
const allowsOnlyBiome26 = (specifier: unknown): boolean => {
  if (typeof specifier !== 'string' || validRange(specifier) === null) {
    return false;
  }
  const lowest = minVersion(specifier);
  return lowest !== null && gte(lowest, MIN_BIOME_VERSION);
};

/**
 * Whether the workspace runs Biome 2.6 or later once `nx migrate` finishes.
 *
 * The version sync runs after this migration in the same `nx migrate`, so the
 * root `package.json` still holds the old Biome here. The check takes the lowest
 * version the declared range (or the catalog entry it references) allows, then
 * the version the sync will move Biome to. A tag, alias or missing declaration
 * counts only when the sync moves it.
 */
const runsBiome26AfterMigrate = async (tree: Tree): Promise<boolean> => {
  if (!tree.exists('package.json')) {
    return false;
  }
  const { dependencies, devDependencies } = readJson(tree, 'package.json');
  const declared: unknown = devDependencies?.[BIOME] ?? dependencies?.[BIOME];
  if (declared === undefined) {
    return false;
  }
  const resolved = getDependencyVersionFromPackageJson(
    tree,
    BIOME,
    'package.json',
    ['devDependencies', 'dependencies'],
  );
  if (allowsOnlyBiome26(resolved)) {
    return true;
  }
  return allowsOnlyBiome26(
    syncedTsVersion(tree, await ownedDependencies(tree), BIOME, declared),
  );
};

const SKIPPED_NEXT_STEP =
  'Biome stays below 2.6 in this workspace, and Biome 2.5 rejects the `markdown` and `yaml` keys, so biome.json was left as it is. ' +
  'Biome 2.6 formats Markdown and YAML files by default. After you move `@biomejs/biome` to 2.6 or later, add ' +
  '`"markdown": { "formatter": { "enabled": false } }` and `"yaml": { "formatter": { "enabled": false } }` to biome.json, ' +
  'or the `format` target fails on generated README.md and YAML files.';

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  if (!tree.exists(BIOME_CONFIG)) {
    return { nextSteps: [] };
  }

  const biome: Record<string, unknown> = readJson(tree, BIOME_CONFIG);
  const missing = LANGUAGES.filter((language) => biome[language] === undefined);
  if (missing.length === 0) {
    return { nextSteps: [] };
  }
  if (!(await runsBiome26AfterMigrate(tree))) {
    return { nextSteps: [SKIPPED_NEXT_STEP] };
  }

  const additions = Object.fromEntries(
    missing.map((language) => [language, FORMATTER_OFF]),
  );
  const entries = Object.entries(biome);
  const cssIndex = entries.findIndex(([key]) => key === 'css');
  const insertAt = cssIndex === -1 ? entries.length : cssIndex + 1;
  writeJson(
    tree,
    BIOME_CONFIG,
    Object.fromEntries([
      ...entries.slice(0, insertAt),
      ...Object.entries(additions),
      ...entries.slice(insertAt),
    ]),
  );

  await formatFilesInSubtree(tree);

  return { nextSteps: [] };
}
