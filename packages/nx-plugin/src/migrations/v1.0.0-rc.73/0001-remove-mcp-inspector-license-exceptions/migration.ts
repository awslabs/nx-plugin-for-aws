/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, type Tree } from '@nx/devkit';
import { removeLicenseExceptions } from '../../../license/config';
import { registerPnpmBuiltDependencies } from '../../../utils/pnpm-workspace';

const INSPECTOR = '@modelcontextprotocol/inspector';

/**
 * MCP Inspector v1 declared `SEE LICENSE IN LICENSE`, which resolves to no SPDX
 * identifier, so the license check needed an exception per published package.
 * v2 ships as a single package declaring `MIT`, which the allowlist already
 * covers, and the stale exceptions would override that with `Apache-2.0`.
 */
const OBSOLETE_EXCEPTIONS = [
  INSPECTOR,
  `${INSPECTOR}-cli`,
  `${INSPECTOR}-server`,
  `${INSPECTOR}-client`,
];

/** Whether the workspace root declares the inspector as a devDependency. */
const hasInspector = (tree: Tree): boolean => {
  if (!tree.exists('package.json')) {
    return false;
  }
  const packageJson = readJson(tree, 'package.json');
  return Boolean(
    packageJson.devDependencies?.[INSPECTOR] ??
      packageJson.dependencies?.[INSPECTOR],
  );
};

export default async function migration(tree: Tree): Promise<void> {
  await removeLicenseExceptions(tree, OBSOLETE_EXCEPTIONS);

  // The version sync bumps the inspector to v2, which added a postinstall
  // script. Register it as an explicitly-rejected build so the upgrade's
  // install isn't failed by pnpm 11's default `strictDepBuilds=true`.
  if (hasInspector(tree)) {
    registerPnpmBuiltDependencies(tree, { [INSPECTOR]: false });
  }
}
