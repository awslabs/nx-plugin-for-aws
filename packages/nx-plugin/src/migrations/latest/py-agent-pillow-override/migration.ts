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
import { formatFilesInSubtree } from '../../../utils/format.js';
import type { UVPyprojectToml } from '../../../utils/nxlv-python.js';
import { addUvOverrideDependencies } from '../../../utils/py.js';
import { tryReadToml } from '../../../utils/toml.js';

/**
 * Add the strands-agents-tools pillow override to the workspace root
 * pyproject.toml uv override-dependencies.
 *
 * strands-agents-tools caps pillow below the release that fixes its current
 * CVEs, and uv reads `[tool.uv] override-dependencies` only from the workspace
 * root, so the root carries the override (`PY_UV_OVERRIDES`). It applies when
 * any project's `[project].dependencies` names strands-agents-tools. A user
 * override for the same package is kept as written. `uv.lock` is left to the
 * user, as the version sync leaves it, so `nextSteps` asks for `uv sync` when
 * the root changes.
 */
export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  if (tree.exists('pyproject.toml')) {
    const requirements = [...getProjects(tree).values()].flatMap(({ root }) => {
      const dependencies = (
        tryReadToml(tree, joinPathFragments(root, 'pyproject.toml')) as
          | UVPyprojectToml
          | undefined
      )?.project?.dependencies;
      return Array.isArray(dependencies) ? dependencies : [];
    });
    if (addUvOverrideDependencies(tree, requirements)) {
      nextSteps.push(
        'The workspace root pyproject.toml now overrides a dependency of strands-agents-tools. Run `uv sync` to update uv.lock.',
      );
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
