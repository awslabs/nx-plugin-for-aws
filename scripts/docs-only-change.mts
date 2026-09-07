/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/**
 * Reports whether a change touches nothing outside `docs/`, which lets CI skip
 * the smoke tests - they exercise generated projects, which the docs site
 * cannot affect.
 *
 * Run by the `docs-only-change` composite action, which supplies the commits to
 * diff as `BASE_SHA` and `HEAD_SHA`.
 */

const COMMIT_SHA = /^[0-9a-f]{40}$/;

const git = (...args: string[]) =>
  execFileSync('git', args, { encoding: 'utf-8' });

/** Whether the SHA names a commit in this clone. */
const isHeldCommit = (sha: string | undefined): sha is string => {
  if (!sha || !COMMIT_SHA.test(sha)) {
    return false;
  }
  try {
    git('cat-file', '-e', `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
};

const isDocsOnly = (baseSha: string, headSha: string) => {
  const changed = git('diff', '--name-only', `${baseSha}...${headSha}`)
    .split('\n')
    .filter(Boolean);
  return (
    changed.length > 0 && changed.every((file) => file.startsWith('docs/'))
  );
};

const { BASE_SHA, HEAD_SHA, GITHUB_OUTPUT } = process.env;

// Anything but a pair of commits we hold - a workflow_dispatch run, a new
// branch, a force push whose previous head is gone - runs everything.
const docsOnly =
  isHeldCommit(BASE_SHA) && isHeldCommit(HEAD_SHA)
    ? isDocsOnly(BASE_SHA, HEAD_SHA)
    : false;

console.log(`docs-only=${docsOnly}`);

if (GITHUB_OUTPUT) {
  appendFileSync(GITHUB_OUTPUT, `docs-only=${docsOnly}\n`);
}
