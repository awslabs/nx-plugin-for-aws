/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { TS_ASTRO_DOCS_GENERATOR_INFO } from '../../../ts/astro-docs/generator.js';
import { insertViaGritQL, matchGritQL } from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { isEsmWorkspace } from '../../../utils/module-format.js';
import { getPackageManagerDisplayCommands } from '../../../utils/pkg-manager.js';

/**
 * Rewrite the docs translate script so it writes whole translated files.
 *
 * The script used to tell the agent to update an existing translation with
 * `str_replace` edits. A replacement that did not match cleanly duplicated or
 * spliced sections, and nothing checked the result, so the damage was committed.
 * The rewrite also fixes incremental runs, which never matched a changed file in
 * a generated workspace, and raises the Bedrock socket timeout that made every
 * large file fail.
 *
 * Most of the script changed, so it is rewritten a declaration at a time. Each
 * pattern in `grit/` matches one declaration as a previous release wrote it and
 * rewrites it to a placeholder, which `insertViaGritQL` swaps for today's version
 * from `files/`. Routing the replacement through a placeholder keeps it out of the
 * pattern: the script is full of template literals, and a GritQL snippet
 * containing a backtick cannot be parsed.
 *
 * Each pattern recognises its declaration by name *and* by statements the released
 * body contained, so a declaration the user has edited no longer matches. The
 * rewrite is all or nothing — every pattern must match before anything is written
 * — so an edited script keeps its whole file and is reported through `nextSteps`
 * rather than being half-rewritten from two different versions.
 */

/**
 * The declarations that changed, in the order they appear in the script. Each name
 * pairs a `grit/<name>.grit` pattern matching its previous form with a
 * `files/<name>.ts.fixture` holding its replacement, which carries any new
 * declarations that follow it.
 *
 * `grit/already-migrated.grit` stands apart: it recognises today's script rather
 * than rewriting anything.
 */
const REWRITES = [
  'project-root',
  'config-path',
  'file-to-translate',
  'log',
  'get-files-to-translate',
  'build-system-prompt',
  'build-user-prompt',
  'translate-file-for-language',
  'run-with-concurrency',
  'main',
  'main-call',
] as const;

/** A leading block comment, which GritQL does not match. */
const HEADER_COMMENT = /^\/\*\*[\s\S]*?\*\/\n/;

const readGritPattern = (name: string): string =>
  `language js\n${readFileSync(join(import.meta.dirname, 'grit', `${name}.grit`), 'utf-8').trim()}`;

const readReplacement = (name: string): string =>
  readFileSync(
    join(import.meta.dirname, 'files', `${name}.ts.fixture`),
    'utf-8',
  );

/** Fills in the values the generator interpolates when it vends the script. */
const render = (
  tree: Tree,
  source: string,
  fullyQualifiedName: string,
): string =>
  source
    .replace(
      /<% if \(esm\) \{ %>(.*?)<% \} else \{ %>(.*?)<% \} %>/g,
      isEsmWorkspace(tree) ? '$1' : '$2',
    )
    .replace(/<%= pkgMgrCmd %>/g, getPackageManagerDisplayCommands().exec)
    .replace(/<%= fullyQualifiedName %>/g, fullyQualifiedName);

const editedNextStep = (projectName: string): string =>
  `${projectName}: its scripts/translate.ts has been customised, so it was left as it is. The script now writes each translation as a whole file rather than editing it in place — see https://awslabs.github.io/nx-plugin-for-aws/guides/astro-docs/ for the version it expects.`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [name, project] of getProjects(tree)) {
    const metadata = project.metadata as { generator?: string } | undefined;
    if (metadata?.generator !== TS_ASTRO_DOCS_GENERATOR_INFO.id) {
      continue;
    }

    // Absent when the docs site was generated with --noTranslation.
    const scriptPath = joinPathFragments(
      project.root,
      'scripts',
      'translate.ts',
    );
    if (!tree.exists(scriptPath)) {
      continue;
    }

    // Already migrated: matched by a declaration only today's script has, so a
    // second run is a no-op rather than a rewrite.
    if (
      await matchGritQL(tree, scriptPath, readGritPattern('already-migrated'))
    ) {
      continue;
    }

    // All or nothing: every declaration must still be the one a release vended,
    // so a partly edited script is never left half-rewritten.
    const matches = await Promise.all(
      REWRITES.map((rewrite) =>
        matchGritQL(tree, scriptPath, readGritPattern(rewrite)),
      ),
    );
    if (!matches.every(Boolean)) {
      nextSteps.push(editedNextStep(name));
      continue;
    }

    // The header is a leading comment, which GritQL does not reach. Anchored to
    // the start of the file so the replacement cannot match anything else.
    tree.write(
      scriptPath,
      (tree.read(scriptPath, 'utf-8') ?? '').replace(
        HEADER_COMMENT,
        render(tree, readReplacement('header'), name),
      ),
    );

    // The first release resolved paths from `__dirname` directly, with no
    // `SCRIPTS_DIR` for the rewrites below to build on.
    const script = tree.read(scriptPath, 'utf-8') ?? '';
    if (!/^const SCRIPTS_DIR /m.test(script)) {
      tree.write(
        scriptPath,
        script.replace(
          /^const PROJECT_ROOT /m,
          `${render(tree, readReplacement('scripts-dir'), name).trimEnd()}\nconst PROJECT_ROOT `,
        ),
      );
    }

    for (const rewrite of REWRITES) {
      await insertViaGritQL(
        tree,
        scriptPath,
        readGritPattern(rewrite),
        render(tree, readReplacement(rewrite), name).trimEnd(),
      );
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
