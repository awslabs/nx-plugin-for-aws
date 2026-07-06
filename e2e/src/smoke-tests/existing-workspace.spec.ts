/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDirSync } from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCLI, runInstall, tmpProjPath } from '../utils';

/**
 * Smoke test for adding the plugin to an EXISTING (non-Nx) pnpm workspace.
 *
 * Rather than `create @aws/nx-workspace`, this starts from a bare pnpm
 * workspace — the scenario the `init` generator targets — then exercises the
 * deterministic path a user follows to adopt the plugin:
 *   1. add Nx
 *   2. install the plugin
 *   3. run `@aws/nx-plugin:init`
 *   4. run a generator
 *   5. build
 *
 * It asserts only the deterministic outcome (init configures the workspace, a
 * generator runs, the workspace builds) — no AWS deployment.
 */
describe('smoke test - existing-workspace', () => {
  const targetDir = `${tmpProjPath()}/existing-workspace`;
  const projectRoot = `${targetDir}/existing-pnpm`;
  const localRegistry = process.env.NX_E2E_LOCAL_REGISTRY;
  const pluginVersion = process.env.NX_E2E_PRESET_VERSION ?? 'latest';

  const opts = {
    cwd: projectRoot,
    env: {
      NX_DAEMON: 'false',
      NODE_OPTIONS: '--max-old-space-size=8192',
    },
  };

  beforeEach(() => {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(projectRoot);

    // A minimal, pre-existing pnpm workspace — NOT created by the plugin.
    writeFileSync(
      join(projectRoot, 'package.json'),
      JSON.stringify(
        { name: '@existing/source', version: '0.0.0', private: true },
        null,
        2,
      ),
    );
    writeFileSync(
      join(projectRoot, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n',
    );

    // Resolve the @aws scope (plugin + create packages) from the local
    // verdaccio, mirroring how the other smoke tests pin the scope.
    if (localRegistry) {
      writeFileSync(
        join(projectRoot, '.npmrc'),
        [
          `@aws:registry=${localRegistry}`,
          `//${localRegistry.replace(/^https?:\/\//, '').replace(/\/$/, '')}/:_authToken=secretVerdaccioToken`,
          '',
        ].join('\n'),
      );
    }
  });

  afterEach(() => {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
  });

  it('should init an existing pnpm workspace, run a generator and build', async () => {
    // 1. Add Nx to the existing workspace, non-interactively (Nx's own tool
    // for adopting Nx — a prerequisite the plugin builds on top of).
    await runCLI('npx --yes nx@latest init --interactive=false --useGitHub', {
      ...opts,
      prefixWithPackageManagerCmd: false,
      redirectStderr: true,
      silenceError: true,
    });
    // Ensure Nx is installed (nx init may skip its own install in CI).
    await runInstall(opts);

    // 2. Install the plugin (local build via verdaccio).
    await runCLI(
      `add -w -D @aws/nx-plugin@${pluginVersion}`,
      { ...opts, prefixWithPackageManagerCmd: false, redirectStderr: true },
    );

    // 3. Run the init generator — the deterministic configuration step that
    // `nx add @aws/nx-plugin` invokes automatically (run directly here to pin
    // the IaC provider deterministically in CI).
    await runCLI(
      `generate @aws/nx-plugin:init --iac=cdk --no-interactive --prefer-install-dependencies=false`,
      opts,
    );

    // The init generator must have created the plugin config.
    expect(existsSync(join(projectRoot, 'aws-nx-plugin.config.mts'))).toBe(true);

    // 4. Run a generator — proving the workspace is now plugin-ready.
    await runCLI(
      `generate @aws/nx-plugin:ts#project --name=my-lib --no-interactive --prefer-install-dependencies=false`,
      opts,
    );

    // 5. Install the accumulated dependencies, sync references and build.
    await runInstall(opts);
    await runCLI('sync', opts);
    const buildOutput = await runCLI(
      'run-many --target build --all --output-style=stream',
      opts,
    );
    expect(buildOutput).toContain('Successfully ran target build');
  });
});
