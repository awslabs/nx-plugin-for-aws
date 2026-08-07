/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type BackfillPackage,
  backfillMissing,
  type PublishResult,
  runPublishWithRetry,
} from '../packages/nx-plugin/src/utils/release-publish';

/**
 * Publishes the release (retrying transient npm errors, tolerating
 * already-published ones), then backfills any package a recent release left
 * unpublished. Orchestration lives in the unit-tested
 * `packages/nx-plugin/src/utils/release-publish.ts`; this is the IO feeding it.
 *
 * `--backfill-only` skips publishing the pending release and only backfills,
 * building each package from its git tag — safe on a rerun whose HEAD has moved.
 *
 * Usage: tsx scripts/release-publish.ts [--backfill-only]
 */

const PLUGIN_ROOT = 'packages/nx-plugin';

/** Resolve after `ms`, off the event loop rather than spinning the CPU. */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Release packages, read from nx.json so this can't drift from what ships. */
const releasePackages = (): BackfillPackage[] => {
  const nxJson = JSON.parse(execSync('cat nx.json', { encoding: 'utf-8' })) as {
    release?: { projects?: string[] };
  };
  return (nxJson.release?.projects ?? []).map((project) => ({
    project,
    name: JSON.parse(
      execSync(
        `cat dist/packages/${project.replace('@aws/', '')}/package.json`,
        {
          encoding: 'utf-8',
        },
      ),
    ).name,
  }));
};

/** Release version tags (from `v*` tags), without the `v` prefix. */
const releasedTags = (): string[] =>
  execSync("git tag -l 'v*'", { encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean)
    .map((tag) => tag.slice(1));

/** Whether a version of a package is already on the registry. */
const isPublished = (name: string, version: string): boolean => {
  const result = spawnSync('npm', ['view', `${name}@${version}`, 'version'], {
    encoding: 'utf-8',
  });
  return result.status === 0 && result.stdout.trim() === version;
};

/** Run a publish command and capture its combined output for classification. */
const runPublish = (
  command: [string, string[]],
  cwd?: string,
): PublishResult => {
  const [cmd, args] = command;
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf-8' });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  process.stdout.write(output);
  return { status: result.status, output };
};

/** Run the normal release publish, retrying transient errors. */
const publishRelease = (): Promise<void> =>
  runPublishWithRetry(
    'the release',
    () => runPublish(['pnpm', ['nx', 'release', 'publish', '--tag', 'latest']]),
    { onLog: console.warn, sleep },
  );

/**
 * Publish a package at a past version from its git tag, so a package a previous
 * release failed to publish is filled in with the code that shipped — never the
 * current tree.
 */
const publishFromTag = async (
  pkg: BackfillPackage,
  version: string,
): Promise<void> => {
  const worktree = mkdtempSync(join(tmpdir(), 'release-backfill-'));
  try {
    execSync(`git worktree add --detach ${worktree} v${version}`, {
      stdio: 'inherit',
    });
    execSync('pnpm i --frozen-lockfile', { cwd: worktree, stdio: 'inherit' });
    execSync(`pnpm nx run ${pkg.project}:package`, {
      cwd: worktree,
      stdio: 'inherit',
    });
    const distDir = join(
      worktree,
      'dist/packages',
      pkg.project.replace('@aws/', ''),
    );
    if (!existsSync(distDir)) {
      throw new Error(`Built package not found at ${distDir}`);
    }
    await runPublishWithRetry(
      `${pkg.name}@${version}`,
      () => runPublish(['npm', ['publish', '--tag', 'latest']], distDir),
      { onLog: console.warn, sleep },
    );
  } finally {
    execSync(`git worktree remove --force ${worktree}`, { stdio: 'inherit' });
    rmSync(worktree, { force: true, recursive: true });
  }
};

const main = async (): Promise<void> => {
  if (!existsSync(PLUGIN_ROOT)) {
    throw new Error(`Run from the repo root — ${PLUGIN_ROOT} not found.`);
  }
  // `--backfill-only` skips publishing the pending release and only fills in
  // packages a past release left behind, building each from its git tag — safe
  // on a rerun whose HEAD has moved past the commit that cut the release.
  const backfillOnly = process.argv.slice(2).includes('--backfill-only');
  if (!backfillOnly) {
    await publishRelease();
  }
  await backfillMissing(releasePackages(), releasedTags(), {
    isPublished,
    publishFromTag,
    onLog: console.info,
  });
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
