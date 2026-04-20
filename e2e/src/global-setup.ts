/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { startLocalRegistry } from '@nx/js/plugins/jest/local-registry';
import { join } from 'path';
import { execSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';

const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const VERDACCIO_AUTH_TOKEN = 'secretVerdaccioToken';

const USER_BUNFIG_PATH = join(homedir(), '.bunfig.toml');
const USER_YARNRC_PATH = join(homedir(), '.yarnrc.yml');
const BACKUP_SUFFIX = '.e2e-backup';

const backupIfExists = (path: string) => {
  if (existsSync(path)) {
    copyFileSync(path, path + BACKUP_SUFFIX);
  }
};

const restoreBackup = (path: string) => {
  const backup = path + BACKUP_SUFFIX;
  if (existsSync(backup)) {
    copyFileSync(backup, path);
    rmSync(backup, { force: true });
  } else {
    rmSync(path, { force: true });
  }
};

export default async function () {
  try {
    // On shared Windows runners the verdaccio storage outlives the process
    // and `clearStorage: true` below doesn't fully reset it, so publishes
    // on the next run hit "409 Conflict: already present". Wipe first.
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

    // startLocalRegistry points the default registry of every pkg manager at
    // the local verdaccio. Capture that URL, then swap each default back to
    // npmjs with a scope-only override for @aws/* so only our published
    // packages hit verdaccio.
    const localRegistry = process.env.npm_config_registry;
    if (!localRegistry) {
      throw new Error(
        'startLocalRegistry did not set npm_config_registry — cannot continue',
      );
    }

    process.env.npm_config_registry = PUBLIC_REGISTRY;
    process.env.BUN_CONFIG_REGISTRY = PUBLIC_REGISTRY;
    process.env.YARN_REGISTRY = PUBLIC_REGISTRY;
    process.env.YARN_NPM_REGISTRY_SERVER = PUBLIC_REGISTRY;

    // npm / pnpm / yarn-classic read scope config from user ~/.npmrc.
    execSync(`npm config set @aws:registry ${localRegistry}`, {
      windowsHide: true,
    });

    // Yarn berry can't set object-valued config (npmScopes) via env vars.
    backupIfExists(USER_YARNRC_PATH);
    writeFileSync(
      USER_YARNRC_PATH,
      [
        `npmRegistryServer: "${PUBLIC_REGISTRY}"`,
        `unsafeHttpWhitelist:`,
        `  - "localhost"`,
        `npmScopes:`,
        `  aws:`,
        `    npmRegistryServer: "${localRegistry}"`,
        `    npmAuthToken: "${VERDACCIO_AUTH_TOKEN}"`,
        ``,
      ].join('\n'),
      { encoding: 'utf-8' },
    );

    // Bun only reads config from bunfig.toml. User-level covers both the
    // out-of-workspace `bun create` step and subsequent project installs.
    backupIfExists(USER_BUNFIG_PATH);
    writeFileSync(
      USER_BUNFIG_PATH,
      [
        `[install]`,
        `registry = "${PUBLIC_REGISTRY}"`,
        ``,
        `[install.scopes]`,
        `"@aws" = { url = "${localRegistry}", token = "${VERDACCIO_AUTH_TOKEN}" }`,
        ``,
        `[install.cache]`,
        `disable = true`,
        `disableManifest = true`,
        ``,
      ].join('\n'),
      { encoding: 'utf-8' },
    );

    // Publishes need an explicit --registry because the default is now npmjs.
    const publishRegistryFlag = `--registry ${localRegistry}`;

    console.info('Publishing @aws/nx-plugin to local registry');
    try {
      execSync(`npm publish ${publishRegistryFlag}`, {
        env: process.env,
        cwd: join(__dirname, '../../dist/packages/nx-plugin'),
      });
      console.info('@aws/nx-plugin published to local registry');
    } catch (err) {
      console.error(
        `@aws/nx-plugin couldn't be published to local registry: ${err}`,
      );
      throw err;
    }

    console.info('Publishing @aws/nx-plugin-mcp to local registry');
    execSync(`npm publish --tag e2e ${publishRegistryFlag}`, {
      env: process.env,
      cwd: join(__dirname, '../../dist/packages/nx-plugin-mcp'),
    });
    console.info('@aws/nx-plugin-mcp published to local registry');

    console.info('Publishing @aws/create-nx-workspace to local registry');
    execSync(`npm publish --tag e2e ${publishRegistryFlag}`, {
      env: process.env,
      cwd: join(__dirname, '../../dist/packages/create-nx-workspace'),
    });
    console.info('@aws/create-nx-workspace published to local registry');

    // create-nx-workspace uses `npm view` to resolve the preset version,
    // which may fail on Windows with a local registry.
    try {
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
      console.error(`Failed to read published package version: ${err}`);
      throw err;
    }
  } catch (err) {
    console.error(`Failed to start local registry: ${err}`);
    throw err;
  }
  return async () => {
    try {
      execSync('npm config delete @aws:registry', { windowsHide: true });
    } catch {
      // registry may not have been set if startup failed early
    }
    restoreBackup(USER_BUNFIG_PATH);
    restoreBackup(USER_YARNRC_PATH);
    if (global.teardown) {
      console.info('Shutting down local registry...');
      global.teardown();
      console.info('Local registry shut down!');
    }
  };
}
