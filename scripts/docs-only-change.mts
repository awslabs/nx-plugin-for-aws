/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/**
 * Reports whether a pull request touches nothing outside `docs/`, which lets CI
 * skip the smoke tests - they exercise generated projects, which the docs site
 * cannot affect.
 *
 * Run by the `Detect Changes` job in pr.yml, which supplies the commits to diff.
 */

const COMMIT_SHA = /^[0-9a-f]{40}$/;

const { BASE_SHA, HEAD_SHA, GITHUB_OUTPUT } = process.env;

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

const isDocsOnly = () => {
  // Commits we do not hold - a fork whose head is missing, say - leave the
  // change looking like it touches more than the docs, so everything runs.
  if (!isHeldCommit(BASE_SHA) || !isHeldCommit(HEAD_SHA)) {
    return false;
  }
  const changed = git('diff', '--name-only', `${BASE_SHA}...${HEAD_SHA}`)
    .split('\n')
    .filter(Boolean);
  return (
    changed.length > 0 && changed.every((file) => file.startsWith('docs/'))
  );
};

const docsOnly = isDocsOnly();

console.log(`Comparing ${BASE_SHA}...${HEAD_SHA}`);
console.log(`docs-only=${docsOnly}`);

if (GITHUB_OUTPUT) {
  appendFileSync(GITHUB_OUTPUT, `docs-only=${docsOnly}\n`);
}
