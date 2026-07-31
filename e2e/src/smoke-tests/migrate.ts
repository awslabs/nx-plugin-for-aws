/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonFile } from '@nx/devkit';
import { expect } from 'vitest';
import {
  createTestWorkspace,
  pinAwsScopeToLocalRegistry,
  runCLI,
  runInstall,
} from '../utils';

/**
 * Shared driver for the migrate smoke test: creates a workspace on a released
 * version of the plugin, scaffolds a recipe with that version's generators,
 * then upgrades it to the local build with `nx migrate` and asserts the
 * migrated workspace is still green.
 *
 * The "before" workspace is created for real from the registry rather than from
 * a committed fixture, so each hop starts from exactly what a user on that
 * version has. The local build is published to verdaccio under a version
 * strictly above every released one (see `resolveMigrateTargetVersion`), which
 * is the window `nx migrate` executes migrations in.
 *
 * Only the deterministic path is asserted. Prompt migrations are deferred by
 * Nx in a non-interactive run, and the contract this test holds is that
 * deterministic migrations alone keep a generated workspace green.
 */

/** Workspace config file the license generator writes. */
const AWS_NX_PLUGIN_CONFIG_FILE = 'aws-nx-plugin.config.mts';

/** The generator each hop scaffolds the "before" workspace with. */
const TEST_MATRIX_GENERATOR = 'internal#test-matrix';

/** Package manager the migrate hops run under. */
export const MIGRATE_PKG_MGR = 'pnpm';

/**
 * Extra npmrc lines the migrate hops need. The preset is pinned to an exact
 * released version, whose peer ranges the strict resolver can't always satisfy
 * during `create`, so peer strictness is relaxed for the hop.
 */
export const MIGRATE_NPMRC_EXTRA = ['strict-peer-dependencies=false'];

/**
 * Version of the plugin the local build was published to verdaccio as, set by
 * `global-setup` after it stamps and publishes.
 */
export const migrateTargetVersion = (): string => {
  const version = process.env.NX_E2E_MIGRATE_TARGET_VERSION;
  if (!version) {
    throw new Error(
      `The local build was not published for the migrate smoke test, so there is nothing to migrate to: ${process.env.NX_E2E_MIGRATE_SETUP_ERROR ?? 'see e2e/src/global-setup.ts'}`,
    );
  }
  return version;
};

/** Migration entry as written into the workspace's `migrations.json`. */
interface WorkspaceMigration {
  name: string;
  package: string;
  version: string;
  implementation?: string;
  prompt?: string;
}

const readWorkspaceMigrations = (
  projectRoot: string,
): WorkspaceMigration[] | undefined => {
  const migrationsPath = join(projectRoot, 'migrations.json');
  return existsSync(migrationsPath)
    ? (readJsonFile(migrationsPath).migrations as WorkspaceMigration[])
    : undefined;
};

/**
 * Whether the plugin installed in the workspace vends `internal#test-matrix`,
 * which the hop scaffolds with.
 *
 * Asked of the installed plugin rather than inferred from its version number, so
 * no release boundary is hardcoded: the answer comes from the collection the hop
 * is actually about to generate from.
 */
const workspaceHasTestMatrixGenerator = async (opts: {
  cwd: string;
  env: Record<string, string | undefined>;
}): Promise<boolean> => {
  const listOutput = await runCLI('list @aws/nx-plugin', {
    ...opts,
    redirectStderr: true,
    silenceError: true,
  });
  return listOutput.includes(TEST_MATRIX_GENERATOR);
};

/**
 * Migrates a workspace from `startVersion` to the local build and asserts the
 * result is green.
 *
 * @param targetDir directory the workspace is created in
 * @param startVersion released version the workspace starts on
 */
export const runMigrateTest = async (
  targetDir: string,
  startVersion: string,
) => {
  const targetVersion = migrateTargetVersion();
  console.log(`Migrating a workspace from ${startVersion} to ${targetVersion}`);

  // 1. Create the "before" workspace on the released version. Both versions are
  // served by verdaccio (global-setup mirrors the start version into it), so
  // the standard @aws-scope pin resolves each.
  const projectRoot = await createTestWorkspace(
    MIGRATE_PKG_MGR,
    targetDir,
    'migrate-test',
    'cdk',
    undefined,
    startVersion,
  );
  // The generated workspace has no .npmrc of its own, so pin the scope inside it
  // too — every install and `nx migrate` below has to resolve @aws/* from
  // verdaccio rather than the public registry.
  pinAwsScopeToLocalRegistry(projectRoot, MIGRATE_NPMRC_EXTRA);

  const opts = {
    cwd: projectRoot,
    env: {
      NX_DAEMON: 'false',
      NODE_OPTIONS: '--max-old-space-size=8192',
      // Nx defers prompt migrations to the calling agent when it detects one,
      // which changes the run's shape. Assert the plain non-interactive path.
      CLAUDECODE: undefined,
      CLAUDE_CODE: undefined,
      AI_AGENT: undefined,
      CURSOR_TRACE_ID: undefined,
      CODEX_THREAD_ID: undefined,
      GEMINI_CLI: undefined,
      OPENCODE: undefined,
      REPL_ID: undefined,
    },
  };

  const git = (args: string[]): string =>
    execFileSync('git', args, {
      cwd: projectRoot,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });
  // The workspace is created with git already initialised, so snapshots just
  // stage and commit on top of its initial commit. --no-verify skips the
  // git-secrets hook; the identity is set per-command so nothing leaks into the
  // developer's own git config.
  const commitAll = (message: string) => {
    git(['add', '-A']);
    git([
      '-c',
      'user.name=e2e',
      '-c',
      'user.email=e2e@example.com',
      'commit',
      '-m',
      message,
      '--no-verify',
    ]);
  };

  // The workspace must actually be on the start version. `nx migrate` only runs
  // migrations above the installed version, so a workspace that came out on the
  // local build instead would make every migration out of range — a hop that
  // asserts nothing and still passes. Cheap to assert, and it catches any future
  // regression in how the preset's version is resolved (see
  // `createTestWorkspace`, which has to defend against one such override).
  await runInstall(opts);
  expect(
    readJsonFile(join(projectRoot, 'node_modules/@aws/nx-plugin/package.json'))
      .version,
  ).toBe(startVersion);

  // 2. Scaffold the workspace state the user is upgrading from, with the START
  // version's own generators. A release predating `internal#test-matrix` has
  // nothing to scaffold from, so skip the hop rather than assert against a
  // hand-maintained recipe that drifts from what that version actually vended.
  if (!(await workspaceHasTestMatrixGenerator(opts))) {
    console.warn(
      `Skipping the hop from ${startVersion}: its @aws/nx-plugin does not vend ${TEST_MATRIX_GENERATOR}.`,
    );
    return undefined;
  }
  await runMigrateRecipe(opts);

  // The matrix runs the license generator, whose dependency allowlist rejects
  // some of what the matrix itself pulls in (`mariadb` is LGPL). Replace the
  // config with one that only checks source headers — and excludes the patterns
  // a non-git workspace needs — so `license-check` doesn't fail the build for a
  // reason that has nothing to do with migrating. Same template the `test-matrix`
  // lane uses.
  writeFileSync(
    join(projectRoot, AWS_NX_PLUGIN_CONFIG_FILE),
    readFileSync(
      join(__dirname, '../files/aws-nx-plugin.config.mts.template'),
      'utf-8',
    ),
  );

  // Install and sync so the baseline is the fully-resolved workspace a user
  // has, then commit it: `git status` after the migration is how the assertions
  // below tell migration changes apart from baseline noise.
  await runInstall(opts);
  await runCLI('sync', opts);
  await runInstall(opts);
  commitAll(`baseline on ${startVersion}`);

  // 3. Upgrade: rewrite the plugin version and generate migrations.json.
  const migrateOutput = await runCLI(
    `migrate @aws/nx-plugin@${targetVersion}`,
    { ...opts, redirectStderr: true },
  );
  expect(migrateOutput).not.toContain('No updates were applied');

  // Install the versions `nx migrate` wrote, then assert against what actually
  // landed in node_modules rather than the manifest range: on a pnpm workspace
  // the manifest holds `catalog:` and the version itself lives in
  // `pnpm-workspace.yaml`, so the installed package is the package-manager
  // agnostic record of what the upgrade resolved to — and it's what the
  // migrations below actually run from.
  await runInstall(opts);
  expect(
    readJsonFile(join(projectRoot, 'node_modules/@aws/nx-plugin/package.json'))
      .version,
  ).toBe(targetVersion);

  // 4. Run the migrations. Nothing to run is a valid outcome while the
  // collection is empty, so tolerate a missing migrations.json.
  const migrations = readWorkspaceMigrations(projectRoot);
  const runOutput = await runCLI(
    'migrate --run-migrations --if-exists --no-interactive',
    { ...opts, redirectStderr: true },
  );

  if (migrations?.length) {
    assertMigrationRunOutcome(runOutput, migrations, projectRoot);
  } else {
    console.log(
      'No migrations were queued for this hop — asserting the upgraded workspace is green.',
    );
  }

  // 5. Idempotency: re-running the migrations must not change the workspace.
  if (migrations?.length) {
    commitAll('after migrations');
    await runCLI('migrate --run-migrations --if-exists --no-interactive', {
      ...opts,
      redirectStderr: true,
    });
    const status = git(['status', '--porcelain']).trim();
    if (status) {
      throw new Error(
        `Migrations were not idempotent — re-running changed the workspace:\n\n${status}\n\n${git(['diff'])}`,
      );
    }
  }

  // 6. The core contract: the migrated workspace still syncs and builds.
  await runCLI('sync', opts);
  await runInstall(opts);
  const buildOutput = await runCLI(
    'run-many --target build --all --output-style=stream --skip-nx-cache',
    opts,
  );
  expect(buildOutput).toContain('Successfully ran target build');

  return { opts, projectRoot };
};

/**
 * Asserts the outcome of `nx migrate --run-migrations` matches the queued
 * entries: deterministic halves applied, prompt halves materialised under
 * `tools/ai-migrations/` and deferred rather than silently dropped.
 */
const assertMigrationRunOutcome = (
  runOutput: string,
  migrations: WorkspaceMigration[],
  projectRoot: string,
) => {
  const withImplementation = migrations.filter((m) => m.implementation);
  const withPrompt = migrations.filter((m) => m.prompt);

  console.log(
    `Ran ${migrations.length} migration(s): ${withImplementation.length} with a codemod, ${withPrompt.length} with a prompt`,
  );

  // Every codemod must have been attempted. `git log` isn't available for
  // attribution (commits are off by default), so the run output is the record:
  // Nx prints a per-migration header for each entry it processes.
  for (const migration of migrations) {
    expect(runOutput).toContain(`${migration.package}:${migration.name}`);
  }

  // A codemod that threw fails the command, so reaching here means they ran.
  if (withImplementation.length > 0) {
    expect(runOutput).toMatch(
      /Successfully finished running migrations|No changes were made from running/,
    );
  }

  // Prompts are deferred in a non-interactive run — assert they were written
  // out for the user rather than dropped.
  for (const migration of withPrompt) {
    expect(existsSync(join(projectRoot, migration.prompt as string))).toBe(
      true,
    );
    expect(runOutput).toContain(migration.prompt as string);
  }
  if (withPrompt.length > 0) {
    expect(runOutput).toContain('agentic flow disabled');
  }
};

/**
 * Scaffolds the workspace state the hop upgrades from, using the START version's
 * own `internal#test-matrix` generator.
 *
 * That generator ships with the plugin, so a release carries the matrix of the
 * generators *it* had — the hop gets that version's full coverage, and the test
 * never has to know which generators existed when.
 */
const runMigrateRecipe = async (opts: {
  cwd: string;
  env: Record<string, string | undefined>;
}) => {
  await runCLI(
    'generate @aws/nx-plugin:internal#test-matrix --no-interactive --prefer-install-dependencies=false',
    opts,
  );
};
