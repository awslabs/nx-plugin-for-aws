/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync, execSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inc } from 'semver';
// eslint-disable-next-line
import { compareVersions } from '../../../packages/nx-plugin/src/utils/migration-versions';

/**
 * Version resolution for the migrate smoke test.
 *
 * The test upgrades a workspace created on a released version to the local
 * build, so it needs two things: which released version(s) to start from, and
 * what version to publish the local build as.
 */

const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';

/**
 * Dist-tags the migrate smoke test publishes under. Anything but `latest`, so
 * republishing the local build at a higher version leaves `latest` pointing at
 * the `0.0.0` build every other smoke test resolves.
 */
const MIGRATE_DIST_TAG = 'migrate-e2e';
const MIGRATE_START_DIST_TAG = 'migrate-e2e-start';

/** Package published to the registry that the plugin's preset installs from. */
export const MIGRATE_PACKAGES = [
  '@aws/nx-plugin',
  '@aws/nx-plugin-mcp',
  '@aws/create-nx-workspace',
] as const;

/**
 * Number of previous releases to migrate from, newest first — so a migration is
 * exercised against every workspace shape still in the supported range, not just
 * the one a user upgrading today happens to start from. Override with
 * `NX_E2E_MIGRATE_VERSIONS`.
 */
const DEFAULT_START_VERSION_COUNT = 5;

/** Released versions of `@aws/nx-plugin` (from `v*` tags), newest first. */
export const releasedVersionsDescending = (): string[] =>
  execFileSync('git', ['tag', '-l', 'v*'], { encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean)
    .map((tag) => tag.slice(1))
    .sort((a, b) => compareVersions(b, a));

/**
 * Released versions to migrate from, newest first.
 *
 * Read from git tags rather than the registry so the set matches the repo the
 * test runs against, and so a hop is only attempted for a release whose
 * `migrations.json` history is resolvable.
 */
export const migrateStartVersions = (): string[] => {
  const count = Number(
    process.env.NX_E2E_MIGRATE_VERSIONS ?? DEFAULT_START_VERSION_COUNT,
  );
  const released = releasedVersionsDescending();
  if (released.length === 0) {
    throw new Error(
      'No release tags found — the migrate smoke test cannot pick a start version. Fetch tags (git fetch --tags) and retry.',
    );
  }
  return released.slice(0, Math.max(1, count));
};

/**
 * First release whose `@aws/nx-plugin` ships the hidden `internal#test-matrix`
 * generator, which each hop scaffolds with. Releases before it have no such
 * generator, so those hops fall back to a fixed recipe of generators present in
 * every supported start version (see `runMigrateRecipe`).
 *
 * Drop the fallback — and this constant — once the supported range no longer
 * reaches back past it.
 */
const FIRST_VERSION_WITH_TEST_MATRIX = '1.0.0-rc.51';

/** Whether `version` ships the `internal#test-matrix` generator. */
export const hasTestMatrixGenerator = (version: string): boolean =>
  compareVersions(version, FIRST_VERSION_WITH_TEST_MATRIX) >= 0;

/**
 * Version to publish the local build as for the migrate test.
 *
 * `nx migrate` only runs a migration whose version is greater than the
 * installed one and less than or equal to the target, so the local build has to
 * carry a version above every released one — publishing it as its in-repo
 * `0.0.0` would leave every migration out of range and silently assert nothing.
 *
 * A `prerelease` bump of the latest tag lands strictly above it and below any
 * version a real release could pick next, including this repo's rc
 * prereleases (which a `patch`/`minor` bump would leapfrog) — the same rule
 * `scripts/stamp-migrations.ts` stamps unreleased migrations with.
 */
export const resolveMigrateTargetVersion = (): string => {
  const [latest] = releasedVersionsDescending();
  if (!latest) {
    throw new Error(
      'No release tags found — cannot derive a migrate target version. Fetch tags (git fetch --tags) and retry.',
    );
  }
  const target = inc(latest, 'prerelease');
  if (!target) {
    throw new Error(
      `Could not derive a migrate target version from the latest release tag (${latest}).`,
    );
  }
  return target;
};

/**
 * Whether this vitest run includes the migrate test, from the `-t` filter the
 * `smoke-test` target passes (`smoke test - <name>`). An unfiltered run — a bare
 * `vitest` locally — counts, since it would execute the migrate test too.
 */
const runIncludesMigrateTest = (): boolean => {
  const filterIndex = process.argv.findIndex(
    (arg) => arg === '-t' || arg === '--testNamePattern',
  );
  if (filterIndex === -1) {
    return true;
  }
  const filter = process.argv[filterIndex + 1] ?? '';
  return 'smoke test - migrate '.startsWith(filter.trim());
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
 *
 * Skipped entirely unless the run includes the migrate test — every lane shares
 * this setup, and mirroring a release per start version is wasted work (and
 * wasted registry round-trips) for the lanes that never read it.
 */
export const publishForMigrateSmokeTest = (localRegistry: string) => {
  if (!runIncludesMigrateTest()) {
    return;
  }
  const distDir = (pkg: string) =>
    join(__dirname, '../../../dist/packages', pkg.replace('@aws/', ''));
  try {
    const targetVersion = resolveMigrateTargetVersion();
    const stageDir = join(__dirname, '../../../tmp/migrate-e2e');
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
            cwd: join(__dirname, '../../..'),
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
