/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { parse, stringify } from '@iarna/toml';
import { joinPathFragments, type Tree } from '@nx/devkit';
import { parsePipRequirementsLine } from 'pip-requirements-js';
import { normalizeDistributionName } from './names';
import type { UVPyprojectToml } from './nxlv-python';
import { updateToml } from './toml';
import { type IPyDepVersion, withPyVersions } from './versions';

// Dedup key that distinguishes bare packages from the same package with
// extras (e.g. `foo` vs `foo[bar]`), so adding a bare dep doesn't drop a
// previously-added variant with extras.
const depKey = (dep: string): string => {
  const parsed = parsePipRequirementsLine(dep);
  if (parsed?.type !== 'ProjectName') {
    return dep;
  }
  const extras = [...(parsed.extras ?? [])].sort().join(',');
  return extras ? `${parsed.name}[${extras}]` : parsed.name;
};

const mergeDeps = (
  existing: readonly string[] | undefined,
  deps: IPyDepVersion[],
): string[] => {
  // Update deps in place by key so re-running does not reorder the list:
  // existing deps keep their position (with their version refreshed), and only
  // genuinely-new deps are appended.
  const incoming = new Map(withPyVersions(deps).map((d) => [depKey(d), d]));
  const merged = (existing ?? []).map(
    (dep) => incoming.get(depKey(dep)) ?? dep,
  );
  const existingKeys = new Set((existing ?? []).map(depKey));
  for (const [key, dep] of incoming) {
    if (!existingKeys.has(key)) {
      merged.push(dep);
    }
  }
  return merged;
};

/**
 * Add dependencies to a pyproject.toml file
 */
export const addDependenciesToPyProjectToml = (
  tree: Tree,
  projectRoot: string,
  deps: IPyDepVersion[],
) => {
  const projectToml = parse(
    tree.read(joinPathFragments(projectRoot, 'pyproject.toml'), 'utf8'),
  ) as UVPyprojectToml;
  projectToml.project.dependencies = mergeDeps(
    projectToml.project?.dependencies,
    deps,
  );
  tree.write(
    joinPathFragments(projectRoot, 'pyproject.toml'),
    stringify(projectToml),
  );
};

export const addDependenciesToDependencyGroupInPyProjectToml = (
  tree: Tree,
  projectRoot: string,
  group: string,
  deps: IPyDepVersion[],
) => {
  const projectToml = parse(
    tree.read(joinPathFragments(projectRoot, 'pyproject.toml'), 'utf8'),
  ) as UVPyprojectToml;
  projectToml['dependency-groups'] = {
    ...projectToml['dependency-groups'],
    [group]: mergeDeps(projectToml['dependency-groups']?.[group], deps),
  };
  tree.write(
    joinPathFragments(projectRoot, 'pyproject.toml'),
    stringify(projectToml),
  );
};

export interface UvxWithDep {
  dep: string;
  version: string;
  specifier?: string;
}

/**
 * Render a uvx command for a given dependency
 * Pins the version to the one specified in versions.ts
 * Optionally specify withDeps to render uvx --with dep==version
 */
export const uvxCommand = (
  dep: IPyDepVersion,
  args?: string,
  withDeps?: UvxWithDep[],
): string => {
  return `uvx --from ${withPyVersions([dep])[0]} ${
    withDeps
      ? `${withDeps
          .map(
            ({ dep, version, specifier }) =>
              `--with ${dep}${specifier ?? '=='}${version}`,
          )
          .join(' ')} `
      : ''
  }${dep}${args ? ` ${args}` : ''}`;
};

/**
 * Add a workspace dependency from one Python project to another.
 * Adds the dependency to [project].dependencies and [tool.uv.sources].
 */
export const addWorkspaceDependencyToPyProject = (
  tree: Tree,
  projectRoot: string,
  dependencyPackageName: string,
): void => {
  const pyprojectPath = joinPathFragments(projectRoot, 'pyproject.toml');
  if (!tree.exists(pyprojectPath)) {
    return;
  }

  // The dependency string and [tool.uv.sources] key must be the PEP 503
  // distribution name (hyphenated), not the dotted Nx project id, so that uv
  // and @nxlv/python match it to the workspace member and the dependency edge
  // appears in the Nx project graph. Callers may pass either form (eg a dotted
  // `targetProject.name`); normalizing here is idempotent for names that are
  // already normalised.
  const distributionName = normalizeDistributionName(dependencyPackageName);

  updateToml(tree, pyprojectPath, (toml: UVPyprojectToml) => {
    // Add to [project].dependencies if not already present
    const deps = toml.project?.dependencies ?? [];
    if (
      !deps.some(
        (d) =>
          d === distributionName ||
          d.startsWith(`${distributionName}>=`) ||
          d.startsWith(`${distributionName}==`),
      )
    ) {
      toml.project.dependencies = [...deps, distributionName];
    }

    // Add to [tool.uv.sources] with workspace = true
    toml.tool = toml.tool ?? {};
    (toml.tool as any).uv = (toml.tool as any).uv ?? {};
    (toml.tool as any).uv.sources = (toml.tool as any).uv.sources ?? {};
    (toml.tool as any).uv.sources[distributionName] = {
      workspace: true,
    };

    return toml;
  });
};
