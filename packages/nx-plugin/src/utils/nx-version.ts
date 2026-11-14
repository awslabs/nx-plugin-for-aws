/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { logger, readJson, type Tree } from '@nx/devkit';
import { getCatalogManager } from 'nx/src/utils/catalog';
import { major } from 'semver';
import PackageJson from '../../package.json' with { type: 'json' };
import {
  buildInstallCommand,
  buildPackageManagerExecCommand,
} from './commands.js';
import {
  detectWorkspacePackageManager,
  parseSimpleRange,
} from './dependencies.js';
import { NX_VERSION } from './versions.js';

const INSTALLED_NX_PACKAGE_JSON = 'node_modules/nx/package.json';

// Set once the unknown-version warning has been logged in this process.
let warnedUnknownVersion = false;

/**
 * Read the workspace's nx version: the installed `node_modules/nx` package
 * when present, otherwise the root package.json `nx` range (following a
 * `catalog:` reference) reduced to a version. Returns `undefined` when neither
 * can be read or the range is not a single simple range.
 */
export const readWorkspaceNxVersion = (tree: Tree): string | undefined => {
  try {
    if (tree.exists(INSTALLED_NX_PACKAGE_JSON)) {
      const { version } = readJson(tree, INSTALLED_NX_PACKAGE_JSON);
      return parseSimpleRange(version)?.version;
    }
    if (!tree.exists('package.json')) {
      return undefined;
    }
    const { dependencies, devDependencies } = readJson(tree, 'package.json');
    let declared: string | undefined = devDependencies?.nx ?? dependencies?.nx;
    if (declared?.startsWith('catalog:')) {
      declared =
        getCatalogManager(tree.root)?.resolveCatalogReference(
          tree,
          'nx',
          declared,
        ) ?? undefined;
    }
    return declared ? parseSimpleRange(declared)?.version : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Throw when the workspace's nx major is older than the Nx this plugin is
 * built against, naming the upgrade commands for the workspace's package
 * manager. Every generator except the workspace preset calls this before it
 * writes a file. An unknown version passes with a single warning.
 *
 * The commands migrate to the plugin's exact `NX_VERSION`. When the installed
 * plugin is newer than the release that raised the Nx version,
 * `nx migrate @aws/nx-plugin@latest` finds nothing to update and leaves Nx
 * where it is.
 */
export const assertSupportedNxVersion = (tree: Tree): void => {
  const required = major(NX_VERSION);
  const version = readWorkspaceNxVersion(tree);
  if (version === undefined) {
    if (!warnedUnknownVersion) {
      warnedUnknownVersion = true;
      logger.warn(
        `${PackageJson.name} ${PackageJson.version} needs Nx ${required}, but the workspace's nx version could not be read. Continuing.`,
      );
    }
    return;
  }
  if (major(version) < required) {
    const pm = detectWorkspacePackageManager(tree);
    const upgradeCommand = [
      buildPackageManagerExecCommand(pm, `nx migrate ${NX_VERSION}`),
      buildInstallCommand(pm),
      buildPackageManagerExecCommand(pm, 'nx migrate --run-migrations'),
    ].join(' && ');
    throw new Error(
      `${PackageJson.name} ${PackageJson.version} needs Nx ${required}, but this workspace has Nx ${version}. Upgrade Nx with: ${upgradeCommand}`,
    );
  }
};
