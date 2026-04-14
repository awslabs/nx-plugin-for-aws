/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { startLocalRegistry } from '@nx/js/plugins/jest/local-registry';
import { join } from 'path';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
export default async function () {
  try {
    const registryPath = join(__dirname, '../../tmp');
    if (existsSync(registryPath)) {
      console.info('Cleaning up old registry store...');
      rmSync(registryPath, { force: true, recursive: true });
    }
    console.info('Starting local registry...');
    global.teardown = await startLocalRegistry({
      localRegistryTarget: '@aws/nx-plugin-source:local-registry',
      verbose: true,
      clearStorage: true,
    });
    console.info('Local registry started!');
    console.info('Publishing @aws/nx-plugin to local registry');
    try {
      execSync(`npm publish`, {
        env: process.env,
        cwd: join(__dirname, '../../dist/packages/nx-plugin'),
      });
      console.info('Package published to local registry');

      console.info('Publishing @aws/nx-plugin-mcp to local registry');
      execSync(`npm publish`, {
        env: process.env,
        cwd: join(__dirname, '../../dist/packages/nx-plugin-mcp'),
      });
      console.info('@aws/nx-plugin-mcp published to local registry');

      // Read the published package version and set NX_E2E_PRESET_VERSION
      // This is needed because create-nx-workspace uses `npm view` to resolve
      // the preset version, which may fail on Windows with a local registry
      const distPkgJson = JSON.parse(
        readFileSync(
          join(__dirname, '../../dist/packages/nx-plugin/package.json'),
          'utf-8',
        ),
      );
      process.env.NX_E2E_PRESET_VERSION = distPkgJson.version;
      console.info(
        `Set NX_E2E_PRESET_VERSION=${process.env.NX_E2E_PRESET_VERSION}`,
      );
    } catch (err) {
      console.error(`Package couldn't be published to local registry: ${err}`);
      throw err;
    }
  } catch (err) {
    console.error(`Failed to start local registry: ${err}`);
    throw err;
  }
  return async () => {
    if (global.teardown) {
      console.info('Shutting down local registry...');
      global.teardown();
      console.info('Local registry shut down!');
    }
  };
}
