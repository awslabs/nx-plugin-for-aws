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
import { applyGritQL, matchGritQL } from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * Move a Smithy API onto the renamed `@smithy/server-*` packages.
 *
 * The Smithy server runtime was published as `@aws-smithy/server-*`, stopped at
 * `1.0.0-alpha.10`, and was renamed to `@smithy/server-*`. The Server SDK codegen
 * this release vends generates against the renamed packages, importing
 * `AuthScheme` and `ServerInterceptor` — types the deprecated packages never
 * exported — so a workspace left on them fails to bundle its SSDK.
 *
 * Both the imports and the declarations move: the renamed packages are no longer
 * the same names, so the version sync cannot recognise the old ones and would
 * leave them installed alongside the new.
 *
 * Guardrails:
 * - Scoped to a Smithy API project this plugin generated, found through the
 *   metadata the generator records. A file of the user's own that happens to
 *   import these packages is left alone.
 * - Imports are rewritten by module specifier, preserving whatever the file
 *   imports from it, so a project that imports more than the generated shape
 *   keeps its own bindings. Only the two packages the generators vend are
 *   matched: `@aws-smithy/server-common` is a transitive dependency of those and
 *   is never declared or imported directly.
 * - A manifest is only rewritten where it declares the old package, and the new
 *   name takes the field the old one occupied. A workspace that already moved
 *   itself is left alone.
 * - Idempotent: nothing matches the old names once they are gone.
 *
 * Every value here is hardcoded rather than read from the generators: this runs
 * once, for the release that renamed the packages, so it has to keep applying
 * that exact change however far the vended versions and generators move
 * afterwards.
 */

/** The id the `ts#smithy-api` generator records on the projects it creates. */
const SMITHY_API_GENERATOR_ID = 'ts#smithy-api';

/** The renamed packages, old name to new, with the version this release vends. */
const RENAMES = [
  {
    old: '@aws-smithy/server-apigateway',
    renamed: '@smithy/server-apigateway',
    version: '0.2.0',
  },
  {
    old: '@aws-smithy/server-node',
    renamed: '@smithy/server-node',
    version: '0.2.0',
  },
] as const;

/** The source files the generators give these imports. */
const SOURCE_FILES = ['src/handler.ts', 'src/local-server.ts'];

/**
 * Rewrite an import's module specifier, keeping its bindings — `$bindings` holds
 * whatever the file imports, so a binding the project added survives the move.
 */
const importPattern = (from: string, to: string): string =>
  `\`import { $bindings } from '${from}'\` => \`import { $bindings } from '${to}'\``;

/** Whether the file still imports the old package under any other form. */
const hasRemainingImport = (from: string): string =>
  `\`import $_ from '${from}'\``;

/** Rename the packages a manifest declares, reporting whether anything changed. */
const renameInManifest = (tree: Tree, path: string): boolean => {
  if (!tree.exists(path)) {
    return false;
  }
  const json = readJson(tree, path);
  const fields = (['dependencies', 'devDependencies'] as const).filter(
    (field) => RENAMES.some(({ old }) => json[field]?.[old]),
  );
  if (fields.length === 0) {
    return false;
  }
  updateJson(tree, path, (manifest) => {
    for (const field of fields) {
      const declared = manifest[field] as Record<string, string>;
      for (const { old, renamed, version } of RENAMES) {
        if (!declared[old]) {
          continue;
        }
        delete declared[old];
        // The vended pin rather than the old specifier: the renamed line
        // restarted at 0.x, so carrying `1.0.0-alpha.10` across resolves nothing.
        declared[renamed] = version;
      }
    }
    return manifest;
  });
  return true;
};

const divergedNextStep = (path: string): string =>
  `${path}: still imports a deprecated '@aws-smithy/server-*' package in a form this migration does not rewrite - update the import to the matching '@smithy/server-*' package by hand.`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  // Only a Smithy API project this plugin generated carries these packages.
  const projects = [...getProjects(tree).values()].filter(
    (project) =>
      (project.metadata as { generator?: string } | undefined)?.generator ===
      SMITHY_API_GENERATOR_ID,
  );

  for (const project of projects) {
    for (const sourceFile of SOURCE_FILES) {
      const sourcePath = joinPathFragments(project.root, sourceFile);
      if (!tree.exists(sourcePath)) {
        continue;
      }
      for (const { old, renamed } of RENAMES) {
        await applyGritQL(tree, sourcePath, importPattern(old, renamed));
        // A namespace or default import of the same package is left as it is —
        // reported rather than rewritten, so a diverged file is never clobbered.
        if (await matchGritQL(tree, sourcePath, hasRemainingImport(old))) {
          nextSteps.push(divergedNextStep(sourcePath));
        }
      }
    }

    renameInManifest(tree, joinPathFragments(project.root, 'package.json'));
  }

  // A workspace may hoist these to the root manifest, which is not an nx project.
  if (projects.length > 0) {
    renameInManifest(tree, 'package.json');
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
