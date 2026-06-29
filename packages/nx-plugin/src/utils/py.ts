/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { parse, stringify } from '@iarna/toml';
import { joinPathFragments, type Tree } from '@nx/devkit';
import { parsePipRequirementsLine } from 'pip-requirements-js';
import { normalizeDistributionName } from './names';
import type { UVPyprojectToml } from './nxlv-python';
import { readToml, updateToml } from './toml';
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
 * Resolve the PEP 503 distribution name of a Python project from its
 * `pyproject.toml` `[project].name`, falling back to normalising the supplied
 * Nx project id when the project has no readable pyproject yet.
 *
 * This is the authoritative name uv writes into `uv.lock`, so it is the value
 * that must appear in a dependent's `[project].dependencies` /
 * `[tool.uv.sources]` for `@nxlv/python` to infer the workspace dependency
 * edge. Always normalised so the result is a valid distribution name even if
 * an older project still carries a dotted `[project].name`.
 */
const getPyDistributionName = (
  tree: Tree,
  project: { name?: string; root: string },
): string => {
  const pyprojectPath = joinPathFragments(project.root, 'pyproject.toml');
  const projectName = tree.exists(pyprojectPath)
    ? (readToml(tree, pyprojectPath) as unknown as UVPyprojectToml).project
        ?.name
    : undefined;
  return normalizeDistributionName(projectName ?? project.name ?? '');
};

/**
 * Add a workspace dependency from one Python project to another.
 * Adds the dependency to [project].dependencies and [tool.uv.sources].
 *
 * Both projects are passed as Nx project configurations (not names): the
 * dependency's PEP 503 distribution name is derived from its own
 * `pyproject.toml` here, so callers cannot accidentally pass the dotted Nx id
 * (which @nxlv/python splits on `.` and drops, losing the project-graph edge).
 * This is the single entry point all generators use to wire a Python workspace
 * dependency.
 */
export const addWorkspaceDependencyToPyProject = (
  tree: Tree,
  dependentProject: { name?: string; root: string },
  dependencyProject: { name?: string; root: string },
): void => {
  const pyprojectPath = joinPathFragments(
    dependentProject.root,
    'pyproject.toml',
  );
  if (!tree.exists(pyprojectPath)) {
    return;
  }

  const distributionName = getPyDistributionName(tree, dependencyProject);

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
