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

// Files written at user level during setup; restored in teardown.
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
    const registryPath = join(__dirname, '../../tmp');
    if (existsSync(registryPath)) {
      console.info('Cleaning up old registry store...');
      rmSync(registryPath, { force: true, recursive: true });
    }

    // Yarn and bun both retry on any non-2xx response, so bumping these helps
    // smooth over transient 5xx/timeouts from the Verdaccio uplink (used only
    // for the small @aws/* surface — see scoping below).
    process.env.YARN_HTTP_RETRY = '5';
    process.env.YARN_HTTP_TIMEOUT = '90000';

    console.info('Starting local registry...');
    global.teardown = await startLocalRegistry({
      localRegistryTarget: '@aws/nx-plugin-source:local-registry',
      verbose: true,
      clearStorage: true,
    });
    console.info('Local registry started!');

    // `startLocalRegistry` set npm_config_registry / BUN_CONFIG_REGISTRY /
    // YARN_REGISTRY / YARN_NPM_REGISTRY_SERVER to the local verdaccio URL, and
    // configured npm auth for that port. Capture the URL before we override
    // and re-export it so smoke-test specs can reference it.
    const localRegistry = process.env.npm_config_registry;
    if (!localRegistry) {
      throw new Error(
        'startLocalRegistry did not set npm_config_registry — cannot continue',
      );
    }
    process.env.NX_E2E_LOCAL_REGISTRY = localRegistry;

    // Verdaccio is used only for the @aws/* scope. Every other package is
    // fetched directly from npmjs. This dramatically reduces Verdaccio's
    // uplink volume and eliminates the flakiness that came with it (transient
    // upstream errors manifesting as ERR_PNPM_FETCH_404 from localhost:4873).
    // Override the default registry back to npmjs and attach scope-specific
    // config so only @aws/* is routed to Verdaccio.
    process.env.npm_config_registry = PUBLIC_REGISTRY;
    process.env.BUN_CONFIG_REGISTRY = PUBLIC_REGISTRY;
    process.env.YARN_REGISTRY = PUBLIC_REGISTRY;
    process.env.YARN_NPM_REGISTRY_SERVER = PUBLIC_REGISTRY;

    // npm / pnpm / yarn-classic all read scoped registry config from the user
    // .npmrc. `npm config set` persists to ~/.npmrc, so every subprocess picks
    // it up regardless of cwd.
    execSync(`npm config set @aws:registry ${localRegistry}`, {
      windowsHide: true,
    });

    // Yarn berry doesn't support object-valued config via env vars, so write
    // a user-level .yarnrc.yml with an npmScopes entry for @aws.
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

    // Bun reads bunfig.toml; install.scopes maps scope → registry. Write a
    // user-level bunfig.toml so `bun create @aws/nx-workspace` (which runs
    // outside any test project) resolves the scoped package correctly.
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
      ].join('\n'),
      { encoding: 'utf-8' },
    );

    // Publishes must explicitly target Verdaccio since the default registry
    // is now npmjs.
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

    // Read the published package version and set NX_E2E_PRESET_VERSION
    // This is needed because create-nx-workspace uses `npm view` to resolve
    // the preset version, which may fail on Windows with a local registry
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
