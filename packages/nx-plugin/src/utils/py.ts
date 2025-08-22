/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { parse, stringify } from '@iarna/toml';
import { joinPathFragments, Tree } from '@nx/devkit';
import { UVPyprojectToml } from '@nxlv/python/src/provider/uv/types';

/**
 * Add dependencies to a pyproject.toml file
 */
export const addDependenciesToPyProjectToml = (
  tree: Tree,
  projectRoot: string,
  deps: string[],
) => {
  const projectToml = parse(
    tree.read(joinPathFragments(projectRoot, 'pyproject.toml'), 'utf8'),
  ) as UVPyprojectToml;
  const newDeps = new Set(deps);
  projectToml.project.dependencies = [
    // TODO: consider parsing into name and version and replacing where name is the same
    ...(projectToml.project?.dependencies ?? []).filter(
      (dep) => !newDeps.has(dep),
    ),
    ...deps,
  ];
  tree.write(
    joinPathFragments(projectRoot, 'pyproject.toml'),
    stringify(projectToml),
  );
};
