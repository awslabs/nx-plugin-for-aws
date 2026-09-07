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

const {
  BASE_SHA,
  HEAD_SHA,
  GITHUB_TOKEN,
  GITHUB_API_URL = 'https://api.github.com',
  GITHUB_EVENT_NAME,
  GITHUB_REPOSITORY,
  GITHUB_REF_NAME,
  GITHUB_RUN_ID,
  GITHUB_OUTPUT,
} = process.env;

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

const api = async (path: string) => {
  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${GITHUB_TOKEN}`,
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} from ${path}`);
  }
  return response.json();
};

/**
 * The most recent commit on this branch whose CI run went green.
 *
 * A push compares against this rather than against the commit it displaced,
 * because a run that was cancelled - which is how a batch of pushes is usually
 * collapsed - leaves its commits untested. Comparing against the last green
 * commit folds those commits into the diff, so a docs push landing on top of
 * untested code still runs the smoke tests.
 */
const lastValidatedCommit = async (headSha: string) => {
  // Resolving the id from this run is exact; the same endpoint keyed on the
  // workflow's file name can answer for a stale copy of the workflow.
  const { workflow_id } = await api(
    `/repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`,
  );
  const { workflow_runs } = await api(
    `/repos/${GITHUB_REPOSITORY}/actions/workflows/${workflow_id}/runs` +
      `?branch=${GITHUB_REF_NAME}&status=success&per_page=50`,
  );
  return (workflow_runs as { head_sha: string }[])
    .map((run) => run.head_sha)
    .find(
      (sha) =>
        sha !== headSha &&
        isHeldCommit(sha) &&
        // A run that finished out of order, or one from before a force push,
        // says nothing about this commit.
        isAncestorOf(sha, headSha),
    );
};

const isDocsOnly = (baseSha: string, headSha: string) => {
  const changed = git('diff', '--name-only', `${baseSha}...${headSha}`)
    .split('\n')
    .filter(Boolean);
  return (
    changed.length > 0 && changed.every((file) => file.startsWith('docs/'))
  );
};

const resolveBaseSha = async (headSha: string) => {
  if (BASE_SHA) {
    return BASE_SHA;
  }
  if (GITHUB_EVENT_NAME !== 'push') {
    return undefined;
  }
  try {
    return await lastValidatedCommit(headSha);
  } catch (e) {
    console.log(`Could not resolve the last green commit: ${e}`);
    return undefined;
  }
};

// Without a pair of commits to compare - a manually dispatched run, a branch
// with no green run behind it, a force push whose previous head is gone - the
// change is treated as touching more than the docs and everything runs.
const baseSha = isHeldCommit(HEAD_SHA)
  ? await resolveBaseSha(HEAD_SHA)
  : undefined;

const docsOnly =
  isHeldCommit(baseSha) && isHeldCommit(HEAD_SHA)
    ? isDocsOnly(baseSha, HEAD_SHA)
    : false;

console.log(`Comparing ${baseSha ?? '(nothing)'}...${HEAD_SHA}`);
console.log(`docs-only=${docsOnly}`);

if (GITHUB_OUTPUT) {
  appendFileSync(GITHUB_OUTPUT, `docs-only=${docsOnly}\n`);
}
