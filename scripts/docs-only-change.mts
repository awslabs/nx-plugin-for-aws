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
 * Run by the `docs-only-change` composite action, which supplies the head commit
 * as `HEAD_SHA` and, for a pull request, the base commit as `BASE_SHA`.
 */

const COMMIT_SHA = /^[0-9a-f]{40}$/;

/**
 * Ref holding the last commit whose CI run went green, moved by the
 * `mark_validated` job in ci.yml.
 */
const LAST_VALIDATED_REF = 'refs/ci/last-validated';

const { BASE_SHA, HEAD_SHA, GITHUB_EVENT_NAME, GITHUB_OUTPUT } = process.env;

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

const isAncestorOf = (sha: string, descendant: string) => {
  try {
    git('merge-base', '--is-ancestor', sha, descendant);
    return true;
  } catch {
    return false;
  }
};

/**
 * A push compares against the last validated commit rather than against the
 * commit it displaced: a run that was cancelled - which is how a batch of pushes
 * is usually collapsed - leaves its commits untested, and the ref stays where it
 * was until a run goes green. So those commits fold into the diff and a docs
 * push landing on top of untested code still runs the smoke tests.
 */
const lastValidatedCommit = () => {
  const sha = git('ls-remote', 'origin', LAST_VALIDATED_REF).split(/\s/)[0];
  return COMMIT_SHA.test(sha) ? sha : undefined;
};

const isDocsOnly = (baseSha: string, headSha: string) => {
  const changed = git('diff', '--name-only', `${baseSha}...${headSha}`)
    .split('\n')
    .filter(Boolean);
  return (
    changed.length > 0 && changed.every((file) => file.startsWith('docs/'))
  );
};

const resolveBaseSha = () => {
  if (BASE_SHA) {
    return BASE_SHA;
  }
  return GITHUB_EVENT_NAME === 'push' ? lastValidatedCommit() : undefined;
};

// Without a pair of commits to compare - a manually dispatched run, a branch
// with no green run behind it yet, a ref left behind by a force push - the
// change is treated as touching more than the docs and everything runs.
const baseSha = resolveBaseSha();

const docsOnly =
  isHeldCommit(baseSha) &&
  isHeldCommit(HEAD_SHA) &&
  isAncestorOf(baseSha, HEAD_SHA)
    ? isDocsOnly(baseSha, HEAD_SHA)
    : false;

console.log(`Comparing ${baseSha ?? '(nothing)'}...${HEAD_SHA}`);
console.log(`docs-only=${docsOnly}`);

if (GITHUB_OUTPUT) {
  appendFileSync(GITHUB_OUTPUT, `docs-only=${docsOnly}\n`);
}
