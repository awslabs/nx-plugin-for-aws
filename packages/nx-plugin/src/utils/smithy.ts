/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as childProcess from 'node:child_process';
import { logger } from '@nx/devkit';
import { SMITHY_VERSIONS } from './versions';

/**
 * How a generated Smithy project runs the Smithy CLI.
 *
 * Everywhere `mise` runs, the CLI is resolved by `mise exec smithy@<version>`,
 * which downloads and caches the pinned version on first use — so a Smithy build
 * needs no tool installed beyond the workspace's own dependencies.
 *
 * On Windows `mise` is not available as a workspace dependency: the `mise` npm
 * package is a stub whose `preinstall` fetches a platform package, and no Windows
 * platform package is published. A root dependency on it would fail every install
 * on Windows rather than just Smithy builds, so Windows users install the Smithy
 * CLI themselves and the target invokes `smithy` directly.
 */

/**
 * Where `mise` lands in a workspace, for a target command to invoke.
 *
 * Called by path rather than by name: only pnpm and npm put a `mise` shim in
 * `node_modules/.bin`, so `mise` alone is not on `PATH` under yarn — while every
 * package manager lays the package itself out here, pnpm by symlink. Written with
 * forward slashes, which Windows accepts too.
 */
const MISE_BIN = 'node_modules/mise/bin/mise';

/**
 * The prefix a target command runs the Smithy CLI through.
 *
 * Pinned via `mise exec` off Windows, where the version travels in the command
 * for the sync to move forward. On Windows the CLI comes from the user's PATH, so
 * there is no version to pin — {@link warnIfSmithyMissing} checks it is there.
 */
export const smithyCliCommand = (): string =>
  isWindows()
    ? 'smithy'
    : `${MISE_BIN} exec smithy@${SMITHY_VERSIONS.cli} -- smithy`;

/**
 * Whether the workspace this generator runs in targets Windows, where the Smithy
 * CLI is a user-installed prerequisite.
 *
 * Read at generate time rather than build time: the resolved command is baked
 * into `project.json`, matching how `containers.engine` is resolved.
 */
export const isWindows = (): boolean => process.platform === 'win32';

/** Whether a Smithy CLI is resolvable on the PATH. */
const isSmithyOnPath = (): boolean => {
  try {
    childProcess.execSync('where smithy', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/**
 * Warn when generating a Smithy project on Windows without the CLI installed.
 *
 * A warning rather than an error: the project is still generated correctly, and
 * the CLI can be installed before the first build.
 *
 * @param onPath overrides the PATH probe, so a test can cover the Windows branch
 *   from any runner — ESM module namespaces cannot be spied on.
 */
export const warnIfSmithyMissing = (
  onPath: () => boolean = isSmithyOnPath,
): void => {
  if (!isWindows() || onPath()) {
    return;
  }
  logger.warn(
    `The Smithy CLI was not found on your PATH. Smithy projects build with it directly on Windows, so install it before building: https://smithy.io/2.0/guides/smithy-cli/cli_installation.html`,
  );
};
