/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { parse, stringify } from '@iarna/toml';
import { joinPathFragments, Tree } from '@nx/devkit';
import type { UVPyprojectToml } from './nxlv-python';
import { IPyDepVersion, withPyVersions } from './versions';
import { parsePipRequirementsLine } from 'pip-requirements-js';
import { updateToml } from './toml';

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
  const incomingKeys = new Set(deps.map(depKey));
  return [
    ...(existing ?? []).filter((dep) => !incomingKeys.has(depKey(dep))),
    ...withPyVersions(deps),
  ];
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

  updateToml(tree, pyprojectPath, (toml: UVPyprojectToml) => {
    // Add to [project].dependencies if not already present
    const deps = toml.project?.dependencies ?? [];
    if (
      !deps.some(
        (d) =>
          d === dependencyPackageName ||
          d.startsWith(`${dependencyPackageName}>=`) ||
          d.startsWith(`${dependencyPackageName}==`),
      )
    ) {
      toml.project.dependencies = [...deps, dependencyPackageName];
    }

    // Add to [tool.uv.sources] with workspace = true
    toml.tool = toml.tool ?? {};
    (toml.tool as any).uv = (toml.tool as any).uv ?? {};
    (toml.tool as any).uv.sources = (toml.tool as any).uv.sources ?? {};
    (toml.tool as any).uv.sources[dependencyPackageName] = {
      workspace: true,
    };

    return toml;
  });
};
