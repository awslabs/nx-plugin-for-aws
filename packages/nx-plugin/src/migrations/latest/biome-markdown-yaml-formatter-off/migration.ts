/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type MigrationReturnObject,
  readJson,
  type Tree,
  writeJson,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format.js';

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
 */

const BIOME_CONFIG = 'biome.json';

const LANGUAGES = ['markdown', 'yaml'] as const;

const FORMATTER_OFF = { formatter: { enabled: false } };

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
