/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type MigrationReturnObject,
  type Tree,
  visitNotIgnoredFiles,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../../utils/shared-constructs-constants';

/**
 * Replace the legacy angle-bracket FunctionProps type assertion with the modern as syntax in generated API constructs
 *
 * The legacy `<FunctionProps>{ ... }` cast form is not supported by GritQL's
 * TypeScript parser, which silently breaks parsing (and therefore matching)
 * for the entire containing file. Since several other migrations rely on
 * GritQL to update these API construct files, this cast is replaced here with
 * the equivalent, GritQL-compatible `{ ... } as FunctionProps` form. This is
 * matched as an exact literal (rather than via GritQL) since GritQL cannot
 * parse the file while the legacy cast is still present.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 *
 * Guardrails:
 * - Pattern-match before writing: skip files that have diverged from the shape
 *   your generators produce and report them via `nextSteps`, or consider a
 *   hybrid migration, rather than clobbering the user's changes.
 * - Idempotent: re-running must be a no-op.
 * - Format what you write: finish with `formatFilesInSubtree` so the files your
 *   migration wrote are formatted correctly.
 */

const APIS_APP_DIR = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/app/apis`;

const OLD_CAST_OPEN = 'defaultIntegrationOptions: <FunctionProps>{';
const NEW_CAST_OPEN = 'defaultIntegrationOptions: {';
const OLD_CAST_CLOSE = '\n      },\n      buildDefaultIntegration:';
const NEW_CAST_CLOSE =
  '\n      } as FunctionProps,\n      buildDefaultIntegration:';

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  if (!tree.exists(APIS_APP_DIR)) {
    return { nextSteps };
  }

  const apiAppFiles: string[] = [];
  visitNotIgnoredFiles(tree, APIS_APP_DIR, (filePath) => {
    apiAppFiles.push(filePath);
  });

  for (const filePath of apiAppFiles) {
    if (!filePath.endsWith('.ts') || filePath.endsWith('/index.ts')) {
      continue;
    }
    const contents = tree.read(filePath, 'utf-8') ?? '';
    if (!contents.includes(OLD_CAST_OPEN)) {
      // Already migrated, or doesn't use this shape.
      continue;
    }
    if (!contents.includes(OLD_CAST_CLOSE)) {
      nextSteps.push(
        `${filePath}: the defaultIntegrationOptions cast has diverged from the generated shape - left untouched. Manually replace \`<FunctionProps>{ ... }\` with \`{ ... } as FunctionProps\`.`,
      );
      continue;
    }
    tree.write(
      filePath,
      contents
        .replace(OLD_CAST_OPEN, NEW_CAST_OPEN)
        .replace(OLD_CAST_CLOSE, NEW_CAST_CLOSE),
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
