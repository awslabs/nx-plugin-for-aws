/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { compareVersions, isValidVersion } from './migration-versions';

/**
 * Helpers for the release publish step (`scripts/release-publish.ts`).
 *
 * A publish failure is one of three kinds, classified from npm's output:
 * - **benign** — already published; treat as success.
 * - **transient** — a flake a retry can clear (network, 5xx, rate limit,
 *   transparency-log outage); retry before giving up.
 * - **fatal** — anything else (a 403, a validation error); fail the release.
 */

/**
 * npm errors that mean the artifact is already published, so a release should
 * treat them as success rather than aborting and leaving other packages behind.
 *
 * - "an equivalent entry already exists": Sigstore's transparency log already
 *   holds an equivalent provenance entry for this exact artifact, so the publish
 *   that created it succeeded — the version is published.
 * - `EPUBLISHCONFLICT` / "cannot publish over" / "previously published": the
 *   version already exists in the registry (a re-run of an earlier success).
 */
const BENIGN_PUBLISH_ERROR_PATTERNS: readonly RegExp[] = [
  /an equivalent entry already exists/i,
  /EPUBLISHCONFLICT/i,
  /cannot publish over (?:the )?(?:previously|existing)/i,
  /previously published versions?/i,
  /You cannot publish over the previously published versions?/i,
  // nx's own already-published detection also matches this E409 shape.
  /this package is already present/i,
];

/**
 * npm errors worth retrying: a transient network/registry/transparency-log
 * failure that a fresh attempt can clear. `TLOG_CREATE_ENTRY_ERROR` without the
 * "already exists" marker is a transparency-log write that didn't land, which a
 * retry usually completes.
 */
const TRANSIENT_PUBLISH_ERROR_PATTERNS: readonly RegExp[] = [
  /TLOG_CREATE_ENTRY_ERROR/i,
  /\bECONNRESET\b/i,
  /\bETIMEDOUT\b/i,
  /\bENOTFOUND\b/i,
  /\bEAI_AGAIN\b/i,
  /socket hang up/i,
  /network (?:timeout|error)/i,
  /\b429\b|too many requests|rate.?limit/i,
  /\b5\d\d\b|internal server error|bad gateway|service unavailable|gateway time-?out/i,
];

/**
 * Whether npm's combined stdout/stderr for a failed publish contains a benign
 * marker — the artifact is already published — so the release can carry on.
 *
 * Requires at least one benign marker: an empty or unrecognised failure is not
 * benign, so a genuine publish error is never swallowed.
 */
export const isBenignPublishFailure = (output: string): boolean =>
  BENIGN_PUBLISH_ERROR_PATTERNS.some((pattern) => pattern.test(output));

/**
 * Whether npm's output looks like a transient failure worth retrying. A benign
 * failure is never transient (it's already done), so this defers to
 * `isBenignPublishFailure` first.
 */
export const isTransientPublishFailure = (output: string): boolean =>
  !isBenignPublishFailure(output) &&
  TRANSIENT_PUBLISH_ERROR_PATTERNS.some((pattern) => pattern.test(output));

/** How many of the most recent releases the backfill checks for missing packages. */
export const BACKFILL_RELEASE_COUNT = 3;

/**
 * The recent release versions the backfill checks, newest first: the last
 * `BACKFILL_RELEASE_COUNT` releases. A partial release (one whose publish left a
 * package behind) is caught by re-checking each package of these against npm and
 * publishing whatever is missing — so no version needs listing by hand, and the
 * window stays small enough that the check is cheap and can't resurrect a package
 * intentionally unpublished long ago.
 *
 * @param tags release version tags without the `v` prefix, in any order
 */
export const backfillVersions = (
  tags: readonly string[],
  count: number = BACKFILL_RELEASE_COUNT,
): string[] =>
  [...tags]
    .filter((tag) => isValidVersion(tag))
    .sort((a, b) => compareVersions(b, a))
    .slice(0, count);

/** Outcome of a single publish attempt, as seen by the retry loop. */
export interface PublishResult {
  /** Process exit code; 0 is success. */
  status: number | null;
  /** Combined stdout/stderr, classified for benign/transient errors. */
  output: string;
}

/** Publish attempts before giving up (1 initial + retries on transient errors). */
export const MAX_PUBLISH_ATTEMPTS = 3;

/**
 * Run a publish, retrying transient failures with backoff and treating an
 * already-published failure as success. Returns after a success or a tolerated
 * benign failure; throws on a fatal error or once transient retries are spent.
 *
 * The publish itself and the wait are injected so the loop can be exercised
 * without a real registry.
 *
 * @param label what is being published, for log messages
 * @param publish runs one publish attempt
 * @param io.onLog receives progress/warn messages
 * @param io.sleep waits between attempts (ms)
 * @param io.maxAttempts overrides the attempt cap (defaults to MAX_PUBLISH_ATTEMPTS)
 */
export const runPublishWithRetry = async (
  label: string,
  publish: () => Promise<PublishResult> | PublishResult,
  io: {
    onLog: (message: string) => void;
    sleep: (ms: number) => Promise<void>;
    maxAttempts?: number;
  },
): Promise<void> => {
  const maxAttempts = io.maxAttempts ?? MAX_PUBLISH_ATTEMPTS;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { status, output } = await publish();
    if (status === 0) {
      return;
    }
    if (isBenignPublishFailure(output)) {
      io.onLog(
        `Publishing ${label} reported an already-published error; treating it as published.`,
      );
      return;
    }
    if (isTransientPublishFailure(output) && attempt < maxAttempts) {
      const backoffMs = 5000 * attempt;
      io.onLog(
        `Publishing ${label} hit a transient error (attempt ${attempt}/${maxAttempts}); retrying in ${backoffMs / 1000}s...`,
      );
      await io.sleep(backoffMs);
      continue;
    }
    throw new Error(`Publishing ${label} failed with exit code ${status}`);
  }
};

/** A release package the backfill can check and (re)publish. */
export interface BackfillPackage {
  /** nx project name, e.g. `@aws/nx-plugin`. */
  project: string;
  /** npm package name it publishes under. */
  name: string;
}

/**
 * For each recent release, publish any package missing from the registry,
 * building it from that version's git tag. Best-effort: a package that fails to
 * backfill is logged and skipped, never aborting the rest — a partial release
 * repair should get as far as it can.
 *
 * All IO is injected so this can run against a real registry in tests without
 * the git-worktree build.
 *
 * @param packages the release packages to check
 * @param tags release version tags (without `v`), any order
 * @param io.isPublished whether name@version is already on the registry
 * @param io.publishFromTag builds name@version from its tag and publishes it
 * @param io.onLog receives progress/warn messages
 * @param io.count backfill window (defaults to BACKFILL_RELEASE_COUNT)
 */
export const backfillMissing = async (
  packages: readonly BackfillPackage[],
  tags: readonly string[],
  io: {
    isPublished: (name: string, version: string) => Promise<boolean> | boolean;
    publishFromTag: (pkg: BackfillPackage, version: string) => Promise<void>;
    onLog: (message: string) => void;
    count?: number;
  },
): Promise<void> => {
  for (const version of backfillVersions(tags, io.count)) {
    for (const pkg of packages) {
      if (await io.isPublished(pkg.name, version)) {
        continue;
      }
      io.onLog(`Backfilling missing ${pkg.name}@${version} from its tag...`);
      try {
        await io.publishFromTag(pkg, version);
        io.onLog(`Backfilled ${pkg.name}@${version}`);
      } catch (err) {
        io.onLog(`Could not backfill ${pkg.name}@${version}: ${err}`);
      }
    }
  }
};
