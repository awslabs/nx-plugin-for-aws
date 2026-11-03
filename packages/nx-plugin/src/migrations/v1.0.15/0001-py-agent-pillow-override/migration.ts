/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type JsonMap, stringify } from '@iarna/toml';
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { parsePipRequirementsLine } from 'pip-requirements-js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { normalizeDistributionName } from '../../../utils/names.js';
import type { UVPyprojectToml } from '../../../utils/nxlv-python.js';
import { tryReadToml } from '../../../utils/toml.js';

/**
 * The overrides this migration shipped with in v1.0.15, keyed by the vended
 * package whose own requirement they override. Kept here, not in versions.ts,
 * so the released behaviour does not change when the generators stop writing
 * the override.
 */
const UV_OVERRIDES: Readonly<Record<string, readonly string[]>> = {
  'strands-agents-tools': ['pillow>=13.0.0'],
};

// PEP 503 name of a requirement, or undefined for one that names no package or
// cannot be parsed.
const requirementName = (requirement: unknown): string | undefined => {
  if (typeof requirement !== 'string') {
    return undefined;
  }
  try {
    const parsed = parsePipRequirementsLine(requirement);
    return parsed?.type === 'ProjectName' || parsed?.type === 'ProjectURL'
      ? normalizeDistributionName(parsed.name)
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Add the `UV_OVERRIDES` entries for the packages named in `requirements` to
 * the workspace root `[tool.uv] override-dependencies`, which is the only place
 * uv reads overrides from.
 *
 * Existing entries keep their order, and a package the list already overrides
 * is left as the user wrote it. The root file is written only when an entry is
 * added. Returns whether it was.
 */
const addUvOverrideDependencies = (
  tree: Tree,
  requirements: readonly string[],
): boolean => {
  const rootPyprojectPath = 'pyproject.toml';
  const toml = tryReadToml(tree, rootPyprojectPath) as
    | UVPyprojectToml
    | undefined;
  if (!toml) {
    return false;
  }
  const names = new Set(requirements.map(requirementName));
  const overrides = Object.entries(UV_OVERRIDES).flatMap(
    ([dependency, entries]) =>
      names.has(normalizeDistributionName(dependency)) ? entries : [],
  );
  if (overrides.length === 0) {
    return false;
  }

  const existing = toml.tool?.uv?.['override-dependencies'];
  if (existing !== undefined && !Array.isArray(existing)) {
    return false;
  }
  const merged = [...(existing ?? [])];
  const overridden = new Set(merged.map(requirementName));
  for (const entry of overrides) {
    const name = requirementName(entry);
    if (!overridden.has(name)) {
      merged.push(entry);
      overridden.add(name);
    }
  }
  if (merged.length === (existing ?? []).length) {
    return false;
  }

  toml.tool ??= {};
  toml.tool.uv ??= {};
  toml.tool.uv['override-dependencies'] = merged;
  tree.write(rootPyprojectPath, stringify(toml as JsonMap));
  return true;
};

/**
 * Add the strands-agents-tools pillow override to the workspace root
 * pyproject.toml uv override-dependencies.
 *
 * strands-agents-tools caps pillow below the release that fixes its current
 * CVEs, and uv reads `[tool.uv] override-dependencies` only from the workspace
 * root, so the root carries the override (`UV_OVERRIDES`). It applies when
 * any project's `[project].dependencies` names strands-agents-tools. A user
 * override for the same package is kept as written. `uv.lock` is left to the
 * user, as the version sync leaves it, so `nextSteps` asks for `uv sync` when
 * the root changes.
 *
 * Released in v1.0.15 and frozen. Generators stopped writing the override
 * once strands-agents-tools 0.8.11 allowed pillow 13. The override is still
 * satisfiable with 0.8.11 (`pillow<14`), so this migration keeps writing it.
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
