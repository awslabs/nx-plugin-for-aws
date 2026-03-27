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

      // Verify the published package on Windows
      if (process.platform === 'win32') {
        try {
          const tmpDir = join(__dirname, '../../tmp/verify-pkg');
          if (existsSync(tmpDir)) rmSync(tmpDir, { force: true, recursive: true });
          mkdirSync(tmpDir, { recursive: true });
          // Create a minimal package.json and try installing
          const fs = require('fs');
          fs.writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test', private: true }));
          const output = execSync(`npm install @aws/nx-plugin --dry-run --json 2>&1`, {
            encoding: 'utf-8',
            env: process.env,
            cwd: tmpDir,
          });
          console.info(`npm install dry-run output: ${output.substring(0, 500)}`);
          rmSync(tmpDir, { force: true, recursive: true });
        } catch (verifyErr) {
          console.error(`Package verification failed: ${verifyErr}`);
        }
      }
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
