/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { parse, stringify } from '@iarna/toml';
import { joinPathFragments, Tree } from '@nx/devkit';
import { UVPyprojectToml } from '@nxlv/python/src/provider/uv/types';
import { IPyDepVersion, withPyVersions } from './versions';
import { parsePipRequirementsLine } from 'pip-requirements-js';

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
  const newDeps = new Set<string>(deps);
  projectToml.project.dependencies = [
    // Replace any dependencies that already exist
    ...(projectToml.project?.dependencies ?? []).filter((dep) => {
      const parsedDep = parsePipRequirementsLine(dep);
      return parsedDep.type !== 'ProjectName' || !newDeps.has(parsedDep.name);
    }),
    ...withPyVersions(deps),
  ];
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
  const newDeps = new Set<string>(deps);
  projectToml['dependency-groups'] = {
    ...projectToml['dependency-groups'],
    [group]: [
      // Replace any dependencies that already exist
      ...(projectToml['dependency-groups']?.[group] ?? []).filter((dep) => {
        const parsedDep = parsePipRequirementsLine(dep);
        return parsedDep.type !== 'ProjectName' || !newDeps.has(parsedDep.name);
      }),
      ...withPyVersions(deps),
    ],
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
  return `uvx ${
    withDeps
      ? `${withDeps
          .map(
            ({ dep, version, specifier }) =>
              `--with ${dep}${specifier ?? '=='}${version}`,
          )
          .join(' ')} `
      : ''
  }${withPyVersions([dep])[0]}${args ? ` ${args}` : ''}`;
};
