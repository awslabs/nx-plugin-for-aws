/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
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

/** Package manager the migrate hops run under. */
export const MIGRATE_PKG_MGR = 'npm';

/**
 * Marker appended to a user-owned file before migrating, asserted to survive:
 * deterministic migrations must report what they don't recognise, not rewrite it.
 */
const USER_MARKER = '// e2e: customised by the user, must not be rewritten';

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
  pinAwsScopeToLocalRegistry(projectRoot, ['legacy-peer-deps=true']);

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

  // 2. Scaffold the recipe with the START version's generators — the workspace
  // state the user is upgrading from.
  await runMigrateRecipe(opts);

  // A deliberately customised user-owned file, to assert deterministic
  // migrations report rather than rewrite what they don't recognise.
  const userOwnedPath = join(projectRoot, 'packages/website/src/main.tsx');
  expect(existsSync(userOwnedPath)).toBe(true);
  appendFileSync(userOwnedPath, `\n${USER_MARKER}\n`, 'utf-8');

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
  expect(
    readJsonFile(join(projectRoot, 'package.json')).dependencies[
      '@aws/nx-plugin'
    ],
  ).toContain(targetVersion);

  // Install the versions `nx migrate` wrote, so the migrations that run are the
  // ones shipped by the target version.
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

  // 5. The user's customisation must have survived.
  expect(readFileSync(userOwnedPath, 'utf-8')).toContain(USER_MARKER);

  // 6. Idempotency: re-running the migrations must not change the workspace.
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

  // 7. The core contract: the migrated workspace still syncs and builds.
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
 * The recipe each migrate hop scaffolds: a representative slice of the
 * dungeon-adventure shape (infra, website + auth, tRPC API, FastAPI, a lambda
 * function and an agent) rather than the full generator matrix.
 *
 * The full matrix is too version-sensitive to run against an older release —
 * generators added or renamed since the start version would need a per-version
 * fork of the matrix. These generators and options have been stable across the
 * supported start versions, so one recipe covers every hop.
 */
const runMigrateRecipe = async (opts: {
  cwd: string;
  env: Record<string, string | undefined>;
}) => {
  const defer = ' --prefer-install-dependencies=false';

  await runCLI(
    `generate @aws/nx-plugin:ts#infra --name=infra --no-interactive${defer}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#website --name=website --no-interactive${defer}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#website#auth --project=@migrate-test/website --cognitoDomain=migrate --no-interactive${defer}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#api --name=my-api --infra=rest-lambda --no-interactive${defer}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@migrate-test/website --targetProject=@migrate-test/my-api --no-interactive${defer}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#api --name=py-api --infra=rest-lambda --no-interactive${defer}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#project --name=ts-project --no-interactive${defer}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#lambda-function --project=ts-project --name=my-function --event=Any --no-interactive${defer}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#agent --project=ts-project --name=my-agent --infra=agentcore --no-interactive${defer}`,
    opts,
  );
};
