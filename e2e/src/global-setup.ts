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

      // Verify create-nx-workspace works on Windows
      if (process.platform === 'win32') {
        try {
          const tmpDir = join(__dirname, '../../tmp/verify-cnw');
          if (existsSync(tmpDir)) rmSync(tmpDir, { force: true, recursive: true });
          mkdirSync(tmpDir, { recursive: true });
          // First test: create workspace with built-in preset (no custom preset)
          console.info('Testing create-nx-workspace with apps preset...');
          execSync(`npx -y create-nx-workspace@22.6.1 test-basic --pm=npm --preset=apps --ci=skip --interactive=false --skipGit`, {
            encoding: 'utf-8',
            env: process.env,
            cwd: tmpDir,
            stdio: 'inherit',
          });
          console.info('Basic workspace creation succeeded!');
          // Second test: create workspace with our preset
          console.info('Testing create-nx-workspace with @aws/nx-plugin preset...');
          execSync(`npx -y create-nx-workspace@22.6.1 test-aws --pm=npm --preset=@aws/nx-plugin --iacProvider=CDK --ci=skip --analytics=false --interactive=false --skipGit`, {
            encoding: 'utf-8',
            env: process.env,
            cwd: tmpDir,
            stdio: 'inherit',
          });
          console.info('AWS preset workspace creation succeeded!');
          rmSync(tmpDir, { force: true, recursive: true });
        } catch (verifyErr) {
          console.error(`Workspace creation verification failed: ${verifyErr}`);
          // Don't throw - let the actual tests report failures
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
