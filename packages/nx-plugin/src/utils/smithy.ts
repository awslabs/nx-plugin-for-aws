/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as childProcess from 'node:child_process';
import { logger } from '@nx/devkit';
import { javaMavenDependency, MISE_VERSIONS, TS_VERSIONS } from './versions';

/**
 * How a generated Smithy project runs the Smithy CLI.
 *
 * Off Windows `mise` resolves the pinned CLI, downloading and caching it on first
 * use, so a Smithy build needs no tool installed on the machine.
 *
 * mise itself is fetched by `npx` rather than added as a workspace dependency. The
 * `mise` npm package is a stub that fetches its real binary in a `preinstall`, and
 * every package manager gates install scripts differently: pnpm, bun and yarn
 * Berry each need their own allowlist entry, bun and yarn fail silently when it is
 * missing, and `nx migrate` installs with `--ignore-scripts` — so a migrated
 * workspace ends up with the package present and no binary. `npx` sidesteps all of
 * it: it runs the package's own bin, resolving from `node_modules` when it happens
 * to be there and fetching it otherwise. A warm cache costs about a second.
 *
 * On Windows mise publishes no platform package to npm, so there the Smithy CLI is
 * a documented prerequisite and the target invokes `smithy` directly.
 */

/**
 * The prefix a target command runs the Smithy CLI through.
 *
 * Off Windows both mise and the CLI are pinned in the command, so the version sync
 * can move them forward. On Windows the CLI comes from the user's PATH, so there is
 * no version to pin — {@link warnIfSmithyMissing} checks it is there.
 */
export const smithyCliCommand = (): string =>
  isWindows()
    ? 'smithy'
    : `npx -y mise@${TS_VERSIONS.mise} exec smithy@${MISE_VERSIONS.smithy} -- smithy`;

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

/**
 * Substitution variables exposing the Smithy Maven pins to the generated
 * `smithy-build.json` templates.
 */
export const smithyMavenVersions = () => ({
  smithyModelDependency: javaMavenDependency(
    'software.amazon.smithy:smithy-model',
  ),
  smithyAwsTraitsDependency: javaMavenDependency(
    'software.amazon.smithy:smithy-aws-traits',
  ),
  smithyValidationModelDependency: javaMavenDependency(
    'software.amazon.smithy:smithy-validation-model',
  ),
  smithyOpenApiDependency: javaMavenDependency(
    'software.amazon.smithy:smithy-openapi',
  ),
  smithyTypeScriptCodegenDependency: javaMavenDependency(
    'software.amazon.smithy.typescript:smithy-aws-typescript-codegen',
  ),
});
