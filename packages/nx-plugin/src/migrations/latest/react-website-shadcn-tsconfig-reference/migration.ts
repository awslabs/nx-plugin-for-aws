/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
  updateJson,
} from '@nx/devkit';
import { relative, sep } from 'path';
import {
  REACT_WEBSITE_APP_GENERATOR_INFO,
  type TsReactWebsiteMetadata,
} from '../../../ts/react-website/app/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_SHADCN_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * De-duplicate the shared shadcn TypeScript project reference in react website projects
 *
 * A `ts#website` re-run appended a second reference to `packages/common/shadcn`
 * alongside the one already there, because `nx sync` rewrites the reference to
 * the project's `tsconfig.json` into the specific `tsconfig.lib.json` it
 * resolves to, and the generator's de-dupe only matched the `tsconfig.json`
 * form. A workspace where that happened is left with duplicate references, so
 * `nx build` refuses to run until `nx sync` collapses them. This migration
 * removes the duplicates directly.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 */

interface TsConfigReference {
  readonly path: string;
}

/**
 * Drop every reference into `projectDirRef` after the first, whichever tsconfig
 * within it each names. The first is kept as-is, so a reference `nx sync` has
 * already resolved to `tsconfig.lib.json` is not churned back.
 */
const dedupeProjectDirReferences = (
  references: TsConfigReference[],
  projectDirRef: string,
): TsConfigReference[] => {
  let seen = false;
  return references.filter((ref) => {
    const isProjectRef =
      ref.path === projectDirRef ||
      ref.path.startsWith(`${projectDirRef}/tsconfig`);
    if (!isProjectRef) {
      return true;
    }
    if (seen) {
      return false;
    }
    seen = true;
    return true;
  });
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const project of getProjects(tree).values()) {
    const metadata = project.metadata as
      | (TsReactWebsiteMetadata & { generator?: string })
      | undefined;
    if (
      metadata?.generator !== REACT_WEBSITE_APP_GENERATOR_INFO.id ||
      metadata.ux !== 'shadcn'
    ) {
      continue;
    }

    const tsconfigAppPath = joinPathFragments(
      project.root,
      'tsconfig.app.json',
    );
    if (!tree.exists(tsconfigAppPath)) {
      continue;
    }

    const sharedShadcnProjectRef = relative(
      joinPathFragments(tree.root, project.root),
      joinPathFragments(tree.root, PACKAGES_DIR, SHARED_SHADCN_DIR),
    )
      .split(sep)
      .join('/');

    updateJson(tree, tsconfigAppPath, (tsconfig) => {
      const references: TsConfigReference[] | undefined = tsconfig.references;
      if (!references) {
        return tsconfig;
      }
      return {
        ...tsconfig,
        references: dedupeProjectDirReferences(
          references,
          sharedShadcnProjectRef,
        ),
      };
    });
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
