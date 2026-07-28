/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startLocalRegistry } from '@nx/js/plugins/jest/local-registry';
import {
  MIGRATE_PACKAGES,
  migrateStartVersions,
  resolveMigrateTargetVersion,
} from './smoke-tests/migrate-versions';

const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const VERDACCIO_AUTH_TOKEN = 'secretVerdaccioToken';

/**
 * Dist-tags the migrate smoke test publishes under. Anything but `latest`, so
 * republishing the local build at a higher version leaves `latest` pointing at
 * the `0.0.0` build every other smoke test resolves.
 */
const MIGRATE_DIST_TAG = 'migrate-e2e';
const MIGRATE_START_DIST_TAG = 'migrate-e2e-start';

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

/**
 * Extra publishes the `migrate` smoke test needs, on top of the local build
 * every other smoke test uses.
 *
 * Two things differ from the default publish:
 *
 * - **The local build gets a version above every release.** `nx migrate` only
 *   runs a migration whose version is greater than the installed one, so the
 *   in-repo `0.0.0` would leave every migration out of range and silently
 *   assert nothing. It is republished under a `prerelease` bump of the latest
 *   tag, with `migrations.json` stamped with that version exactly as the
 *   release job does — under a dedicated dist-tag, so `latest` keeps pointing
 *   at the `0.0.0` build the other smoke tests resolve.
 * - **Each start version is mirrored in.** `.verdaccio/config.yml` deliberately
 *   doesn't proxy the three local packages to npmjs (our `0.0.0` collides with
 *   an early public release), so a released version isn't reachable through the
 *   registry the workspaces are pinned to. Mirroring the tarballs in means one
 *   `@aws:registry` pin serves both ends of the upgrade.
 *
 * A failure here is recorded rather than thrown: every other smoke test shares
 * this setup and doesn't need these publishes, so a registry hiccup fetching an
 * old release shouldn't take the whole run down. The migrate test reads the
 * recorded reason and fails with it.
 */
const publishForMigrateSmokeTest = (localRegistry: string) => {
  const distDir = (pkg: string) =>
    join(__dirname, '../../dist/packages', pkg.replace('@aws/', ''));
  try {
    const targetVersion = resolveMigrateTargetVersion();
    const stageDir = join(__dirname, '../../tmp/migrate-e2e');
    rmSync(stageDir, { force: true, recursive: true });

    // Restamp and republish each local package at the migrate target version,
    // from a copy so the dist the other smoke tests published stays untouched.
    for (const pkg of MIGRATE_PACKAGES) {
      const pkgStageDir = join(stageDir, pkg.replace('@aws/', ''));
      cpSync(distDir(pkg), pkgStageDir, { recursive: true });

      const manifestPath = join(pkgStageDir, 'package.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      manifest.version = targetVersion;
      // Keep the inter-package pins consistent with the version being published
      // so the migrated workspace doesn't pull a mismatched sibling.
      for (const field of [
        'dependencies',
        'devDependencies',
        'peerDependencies',
      ]) {
        for (const dep of Object.keys(manifest[field] ?? {})) {
          if (
            MIGRATE_PACKAGES.includes(dep as (typeof MIGRATE_PACKAGES)[number])
          ) {
            manifest[field][dep] = targetVersion;
          }
        }
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      // Stamp the pending version onto every unversioned migration, exactly as
      // the release job does — an unstamped entry is invisible to nx migrate.
      if (pkg === '@aws/nx-plugin') {
        execSync(
          `pnpm exec tsx ./scripts/stamp-migrations.ts --pending-version ${targetVersion} --out ${JSON.stringify(join(pkgStageDir, 'migrations.json'))}`,
          {
            cwd: join(__dirname, '../..'),
            env: process.env,
            windowsHide: true,
          },
        );
      }

      execSync(
        `npm publish --tag ${MIGRATE_DIST_TAG} --registry ${localRegistry}`,
        { env: process.env, cwd: pkgStageDir },
      );
    }
    process.env.NX_E2E_MIGRATE_TARGET_VERSION = targetVersion;
    console.info(
      `Published the local build as ${targetVersion} for the migrate smoke test`,
    );

    // Mirror each start version's tarballs into verdaccio so the "before"
    // workspace resolves them through the same registry pin.
    //
    // The fetch has to override the *scope* registry, not just the default:
    // the `@aws:registry` entry written above points at verdaccio, and a scope
    // entry wins over `--registry`, so a plain `--registry` fetch would ask
    // verdaccio for a version only npmjs has.
    for (const startVersion of migrateStartVersions()) {
      for (const pkg of MIGRATE_PACKAGES) {
        const packed = JSON.parse(
          execSync(
            `npm pack ${pkg}@${startVersion} --@aws:registry=${PUBLIC_REGISTRY} --json`,
            { cwd: stageDir, encoding: 'utf-8', env: process.env },
          ),
        );
        execSync(
          `npm publish ${packed[0].filename} --tag ${MIGRATE_START_DIST_TAG} --registry ${localRegistry}`,
          { env: process.env, cwd: stageDir },
        );
      }
      console.info(
        `Mirrored @aws/* ${startVersion} into the local registry for the migrate smoke test`,
      );
    }
  } catch (err) {
    process.env.NX_E2E_MIGRATE_SETUP_ERROR = `${err}`;
    console.warn(
      `Could not prepare the migrate smoke test's registry state — the migrate test will fail, other smoke tests are unaffected: ${err}`,
    );
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

    // Expose the local registry URL so `smokeTest` can drop a per-target
    // `.npmrc` alongside each generated workspace. pnpm 11's dlx appears to
    // ignore the user-level `@aws:registry` npmrc entry in some smoke runs
    // (resolving `@aws/create-nx-workspace` to the public `latest` tag),
    // whereas a cwd-local `.npmrc` is always respected.
    process.env.NX_E2E_LOCAL_REGISTRY = localRegistry;

    // npm / pnpm / yarn-classic read scope config from user ~/.npmrc.
    // `npm config set` obeys NPM_CONFIG_USERCONFIG (which setup-node points
    // at a temp path on GitHub Actions), but pnpm 11 reads `$HOME/.npmrc`
    // directly — so we append the scope override to both files.
    execSync(`npm config set @aws:registry ${localRegistry}`, {
      windowsHide: true,
    });
    const homeNpmrcPath = join(homedir(), '.npmrc');
    backupIfExists(homeNpmrcPath);
    const existingHomeNpmrc = existsSync(homeNpmrcPath)
      ? readFileSync(homeNpmrcPath, 'utf-8')
      : '';
    writeFileSync(
      homeNpmrcPath,
      `${existingHomeNpmrc.replace(/\n?$/, '\n')}@aws:registry=${localRegistry}\n//${localRegistry
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '')}/:_authToken=${VERDACCIO_AUTH_TOKEN}\n`,
      { encoding: 'utf-8' },
    );

    backupIfExists(USER_YARNRC_PATH);
    writeFileSync(
      USER_YARNRC_PATH,
      [
        `npmRegistryServer: "${PUBLIC_REGISTRY}"`,
        `unsafeHttpWhitelist:`,
        `  - "localhost"`,
        `npmPreapprovedPackages:`,
        `  - "@aws/*"`,
        `  - "@ag-ui/*"`,
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
    // Must publish as `latest` (not `--tag e2e`) so `pnpm create
    // @aws/nx-workspace` resolves the local 0.0.0 build rather than falling
    // through to the public registry's latest tag (which lacks any in-flight
    // fixes being tested by this smoke run).
    execSync(`npm publish ${publishRegistryFlag}`, {
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

    publishForMigrateSmokeTest(localRegistry);
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
    restoreBackup(join(homedir(), '.npmrc'));
    if (global.teardown) {
      console.info('Shutting down local registry...');
      global.teardown();
      console.info('Local registry shut down!');
    }
  };
}
