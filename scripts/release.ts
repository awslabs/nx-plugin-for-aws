/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { stampMigrationsFile } from './stamp-migrations';

/**
 * The release: version, stamp migrations, tag + changelog, then publish. A
 * single entry point the release job runs, so the flow reads top to bottom
 * rather than being spread across inline workflow bash and several scripts.
 *
 * Publishing is `nx release publish`, retried on a transient failure. nx skips a
 * package already on the registry and tolerates an already-present 409, so a
 * retry only re-attempts what didn't land — safe to run repeatedly, and correct
 * through npm's publish-time scanning window.
 *
 * Usage: tsx scripts/release.ts
 */

const PLUGIN_ROOT = 'packages/nx-plugin';
const DIST = 'dist/packages';
/** The package that ships migrations.json, which needs separate stamping. */
const NX_PLUGIN_PACKAGE = '@aws/nx-plugin';
/** Publish attempts before giving up (1 initial + retries on transient failure). */
const MAX_PUBLISH_ATTEMPTS = 3;

/**
 * Release train. `'rc'` cuts release candidates (1.0.0-rc.x → 1.0.0-rc.x+1);
 * switch to `'stable'` to cut stable releases. The first stable run off an rc
 * tag promotes it to the stable version (dropping the -rc suffix) and subsequent
 * runs follow conventional-commits semver (1.0.1, 1.1.0, …).
 */
const RELEASE_TRAIN: 'rc' | 'stable' = 'rc';
/**
 * The bump applied when promoting the current rc series to its first stable
 * release (e.g. `major`: 1.0.0-rc.x → 1.0.0). Only used on that transition.
 */
const STABLE_PROMOTION_BUMP = 'major';

/** Read a package's built dist manifest version. */
const distVersion = (project: string): string =>
  JSON.parse(
    readFileSync(
      join(DIST, project.replace('@aws/', ''), 'package.json'),
      'utf-8',
    ),
  ).version;

/** Run a command, echoing its output; throws on a non-zero exit. */
const run = (cmd: string, args: string[]): void => {
  execFileSync(cmd, args, { stdio: 'inherit' });
};

/** The most recent release tag (e.g. `v1.0.0-rc.61`), for choosing the bump. */
const currentTag = (): string =>
  execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
    encoding: 'utf-8',
  }).trim();

/**
 * `nx release version` flags, from the release train (`RELEASE_TRAIN`) and the
 * current tag. Verified against nx's git-tag resolver:
 *
 * - rc train → `--preid rc`: bumps 1.0.0-rc.x → 1.0.0-rc.x+1 (or premajor-rc off
 *   a stable tag). `--preid` is also what lets nx's resolver match the rc tag.
 * - stable train, current tag is an rc → `--specifier <bump> --preid rc`: the
 *   `--preid` matches the rc tag; the explicit specifier drops the -rc suffix,
 *   promoting e.g. 1.0.0-rc.x → 1.0.0. (No flags errors here — nx can't resolve
 *   an rc tag as the base for a stable bump.)
 * - stable train, current tag is stable → no flags: nx follows conventional
 *   commits (1.0.1, 1.1.0, …).
 */
const releaseArgs = (): string[] => {
  if (RELEASE_TRAIN === 'rc') {
    return ['--preid', 'rc'];
  }
  const onRcTag = /-rc\./.test(currentTag());
  return onRcTag ? ['--specifier', STABLE_PROMOTION_BUMP, '--preid', 'rc'] : [];
};

/** Overrides for {@link publishWithRetry}, used by the release smoke test. */
export interface PublishOptions {
  /** Dist-tag to publish under. */
  tag?: string;
  /** Extra `nx release publish` args — the smoke test pins a local registry. */
  additionalArgs?: string[];
  /** Attempts before giving up. */
  attempts?: number;
  /** Directory to run from; defaults to the current working directory. */
  cwd?: string;
}

/**
 * Publish the release, retrying a transient failure with backoff. Each attempt
 * re-runs `nx release publish`, which skips packages already on the registry and
 * tolerates an already-present 409 — so a retry only re-attempts what didn't
 * land, and a network blip or a version briefly hidden by npm's publish-time
 * scanning doesn't fail the release.
 *
 * Exported so the `release` smoke test drives this exact function against a
 * local registry: the command nx builds here depends on the active pnpm version,
 * and only running it catches a spelling the package manager rejects.
 */
export const publishWithRetry = async ({
  tag = 'latest',
  additionalArgs = [],
  attempts = MAX_PUBLISH_ATTEMPTS,
  cwd,
}: PublishOptions = {}): Promise<void> => {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const result = spawnSync(
      'pnpm',
      ['nx', 'release', 'publish', '--tag', tag, ...additionalArgs],
      { stdio: 'inherit', cwd },
    );
    if (result.status === 0) {
      return;
    }
    if (attempt === attempts) {
      throw new Error(`nx release publish failed after ${attempts} attempts`);
    }
    const backoffMs = 15000 * attempt;
    console.warn(
      `nx release publish failed (attempt ${attempt}/${attempts}); retrying in ${backoffMs / 1000}s...`,
    );
    await sleep(backoffMs);
  }
};

const main = async (): Promise<void> => {
  if (!existsSync(PLUGIN_ROOT)) {
    throw new Error(`Run from the repo root — ${PLUGIN_ROOT} not found.`);
  }
  const args = releaseArgs();
  // Write the pending version into the dist manifests only (no tag/commit), so
  // migrations can be stamped with it before the tag-and-changelog step resolves
  // the same version.
  run('pnpm', [
    'nx',
    'release',
    'version',
    ...args,
    '--git-tag=false',
    '--git-commit=false',
    '--stage-changes=false',
  ]);
  // migrations.json is assembled unversioned; stamp it with the shipping version.
  stampMigrationsFile(distVersion(NX_PLUGIN_PACKAGE));
  // Tag + changelog (resolves the same version from the git tag), then publish.
  run('pnpm', ['nx', 'release', '--skip-publish', ...args]);
  await publishWithRetry();
};

// Run as a CLI, but not when imported (the release smoke test imports
// publishWithRetry).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
