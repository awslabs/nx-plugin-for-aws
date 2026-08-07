/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BACKFILL_RELEASE_COUNT,
  type BackfillPackage,
  backfillMissing,
  backfillVersions,
  isBenignPublishFailure,
  isTransientPublishFailure,
  type PublishResult,
  runPublishWithRetry,
} from './release-publish';

/** Publish results for the retry-loop tests, keyed by kind. */
const OK: PublishResult = { status: 0, output: 'ok' };
const BENIGN: PublishResult = {
  status: 1,
  output:
    'npm error EPUBLISHCONFLICT cannot publish over the previously published version',
};
const TRANSIENT: PublishResult = {
  status: 1,
  output: 'npm error 503 Service Unavailable',
};
const FATAL: PublishResult = {
  status: 1,
  output: 'npm error 403 Forbidden - you lack access',
};

/** A publish stub returning the given results in order, tracking call count. */
const scriptedPublish = (results: PublishResult[]) => {
  let call = 0;
  const fn = () => results[Math.min(call++, results.length - 1)];
  return { fn: () => fn(), calls: () => call };
};

const noopIo = { onLog: () => {}, sleep: () => Promise.resolve() };

describe('release-publish', () => {
  describe('isBenignPublishFailure', () => {
    it('should treat a Sigstore transparency-log conflict as benign', () => {
      const output = [
        'pnpm publish error:',
        'Error code: TLOG_CREATE_ENTRY_ERROR',
        'error creating tlog entry - (409) an equivalent entry already exists in the transparency log with UUID 108e9186',
      ].join('\n');
      expect(isBenignPublishFailure(output)).toBe(true);
    });

    it('should treat an already-published version as benign', () => {
      expect(
        isBenignPublishFailure(
          'npm error code EPUBLISHCONFLICT\nnpm error You cannot publish over the previously published versions: 1.0.0-rc.61.',
        ),
      ).toBe(true);
    });

    it('should treat npm`s E409 already-present error as benign', () => {
      expect(
        isBenignPublishFailure(
          'npm error code E409\nnpm error 409 Conflict - PUT ... - this package is already present',
        ),
      ).toBe(true);
    });

    it('should treat a real publish error as fatal', () => {
      expect(
        isBenignPublishFailure(
          'npm error code E403\nnpm error 403 Forbidden - PUT https://registry.npmjs.org/@aws%2fnx-plugin - You do not have permission to publish',
        ),
      ).toBe(false);
    });

    it('should treat an unrelated network failure as fatal', () => {
      expect(
        isBenignPublishFailure(
          'npm error code E500\nnpm error 500 Internal Server Error',
        ),
      ).toBe(false);
    });

    it('should treat empty output as fatal so a silent failure is never swallowed', () => {
      expect(isBenignPublishFailure('')).toBe(false);
    });
  });

  describe('isTransientPublishFailure', () => {
    it('should retry a transparency-log write that did not land', () => {
      expect(
        isTransientPublishFailure(
          'npm error Error code: TLOG_CREATE_ENTRY_ERROR\nnpm error error creating tlog entry - (502) upstream error',
        ),
      ).toBe(true);
    });

    it('should retry network and server errors', () => {
      expect(isTransientPublishFailure('npm error network ECONNRESET')).toBe(
        true,
      );
      expect(
        isTransientPublishFailure('npm error 503 Service Unavailable'),
      ).toBe(true);
      expect(isTransientPublishFailure('npm error 429 Too Many Requests')).toBe(
        true,
      );
      expect(
        isTransientPublishFailure('npm error request to ... ETIMEDOUT'),
      ).toBe(true);
    });

    it('should not retry an already-published failure — it is done, not transient', () => {
      expect(
        isTransientPublishFailure(
          'npm error code EPUBLISHCONFLICT\nnpm error cannot publish over the previously published version',
        ),
      ).toBe(false);
      // A tlog conflict whose entry already exists is published, not transient.
      expect(
        isTransientPublishFailure(
          'Error code: TLOG_CREATE_ENTRY_ERROR\n(409) an equivalent entry already exists in the transparency log',
        ),
      ).toBe(false);
    });

    it('should not retry a fatal error', () => {
      expect(
        isTransientPublishFailure('npm error 403 Forbidden - you lack access'),
      ).toBe(false);
      expect(isTransientPublishFailure('')).toBe(false);
    });
  });

  describe('backfillVersions', () => {
    it('should return the most recent releases newest-first', () => {
      expect(
        backfillVersions([
          '1.0.0-rc.59',
          '1.0.0-rc.61',
          '1.0.0-rc.60',
          '1.0.0-rc.58',
        ]),
      ).toEqual(['1.0.0-rc.61', '1.0.0-rc.60', '1.0.0-rc.59']);
    });

    it(`should default to the last ${BACKFILL_RELEASE_COUNT} releases`, () => {
      const tags = ['1.0.0', '2.0.0', '3.0.0', '4.0.0', '5.0.0'];
      expect(backfillVersions(tags)).toHaveLength(BACKFILL_RELEASE_COUNT);
      expect(backfillVersions(tags)).toEqual(['5.0.0', '4.0.0', '3.0.0']);
    });

    it('should return everything when there are fewer releases than the window', () => {
      expect(backfillVersions(['1.0.0-rc.1', '1.0.0-rc.2'])).toEqual([
        '1.0.0-rc.2',
        '1.0.0-rc.1',
      ]);
      expect(backfillVersions([])).toEqual([]);
    });

    it('should ignore non-semver tags', () => {
      expect(
        backfillVersions(['1.0.0-rc.60', 'nightly', '1.0.0-rc.61', 'latest']),
      ).toEqual(['1.0.0-rc.61', '1.0.0-rc.60']);
    });

    it('should honour an explicit count', () => {
      expect(backfillVersions(['1.0.0', '2.0.0', '3.0.0'], 1)).toEqual([
        '3.0.0',
      ]);
    });
  });

  describe('runPublishWithRetry', () => {
    it('A1: should return after a first-try success without retrying', async () => {
      const publish = scriptedPublish([OK]);
      await runPublishWithRetry('x', publish.fn, noopIo);
      expect(publish.calls()).toBe(1);
    });

    it('A2: should tolerate an already-published failure without retrying', async () => {
      const publish = scriptedPublish([BENIGN]);
      await runPublishWithRetry('x', publish.fn, noopIo);
      expect(publish.calls()).toBe(1);
    });

    it('A3/A4: should retry a transient failure until it succeeds', async () => {
      const sleep = vi.fn(() => Promise.resolve());
      const publish = scriptedPublish([TRANSIENT, TRANSIENT, OK]);
      await runPublishWithRetry('x', publish.fn, { onLog: () => {}, sleep });
      expect(publish.calls()).toBe(3);
      expect(sleep).toHaveBeenCalledTimes(2);
      // Backoff grows with the attempt number.
      expect(sleep).toHaveBeenNthCalledWith(1, 5000);
      expect(sleep).toHaveBeenNthCalledWith(2, 10000);
    });

    it('A5: should throw once transient retries are exhausted', async () => {
      const publish = scriptedPublish([TRANSIENT, TRANSIENT, TRANSIENT]);
      await expect(
        runPublishWithRetry('x', publish.fn, noopIo),
      ).rejects.toThrow(/failed with exit code/);
      expect(publish.calls()).toBe(3);
    });

    it('A6: should throw immediately on a fatal error', async () => {
      const publish = scriptedPublish([FATAL]);
      await expect(
        runPublishWithRetry('x', publish.fn, noopIo),
      ).rejects.toThrow(/failed with exit code/);
      expect(publish.calls()).toBe(1);
    });

    it('A7: should tolerate a benign failure that follows a transient one', async () => {
      const publish = scriptedPublish([TRANSIENT, BENIGN]);
      await runPublishWithRetry('x', publish.fn, noopIo);
      expect(publish.calls()).toBe(2);
    });

    it('A8: should throw on a fatal failure that follows a transient one', async () => {
      const publish = scriptedPublish([TRANSIENT, FATAL]);
      await expect(
        runPublishWithRetry('x', publish.fn, noopIo),
      ).rejects.toThrow(/failed with exit code/);
      expect(publish.calls()).toBe(2);
    });
  });

  describe('backfillMissing', () => {
    const PKGS: BackfillPackage[] = [
      { project: '@aws/nx-plugin', name: '@aws/nx-plugin' },
      { project: '@aws/nx-plugin-mcp', name: '@aws/nx-plugin-mcp' },
      { project: '@aws/create-nx-workspace', name: '@aws/create-nx-workspace' },
    ];
    const TAGS = ['1.0.0-rc.61', '1.0.0-rc.60', '1.0.0-rc.59'];

    /** A registry fake: `present` is the set of "name@version" already published. */
    const registry = (present: Iterable<string>) => {
      const published = new Set(present);
      const publishFromTag = vi.fn(async (pkg: BackfillPackage, v: string) => {
        published.add(`${pkg.name}@${v}`);
      });
      return {
        io: {
          isPublished: (name: string, v: string) =>
            published.has(`${name}@${v}`),
          publishFromTag,
          onLog: () => {},
        },
        publishFromTag,
        published,
      };
    };

    const allPresent = (): string[] =>
      PKGS.flatMap((p) => TAGS.map((v) => `${p.name}@${v}`));

    it('B1: should be a no-op when every package is present at every version', async () => {
      const r = registry(allPresent());
      await backfillMissing(PKGS, TAGS, r.io);
      expect(r.publishFromTag).not.toHaveBeenCalled();
    });

    it('B2: should publish a single missing package at the newest version', async () => {
      const present = allPresent().filter(
        (s) => s !== '@aws/nx-plugin-mcp@1.0.0-rc.61',
      );
      const r = registry(present);
      await backfillMissing(PKGS, TAGS, r.io);
      expect(r.publishFromTag).toHaveBeenCalledTimes(1);
      expect(r.publishFromTag).toHaveBeenCalledWith(
        expect.objectContaining({ name: '@aws/nx-plugin-mcp' }),
        '1.0.0-rc.61',
      );
    });

    it('B3: should publish multiple packages missing at one version', async () => {
      const present = allPresent().filter(
        (s) =>
          s !== '@aws/nx-plugin-mcp@1.0.0-rc.61' &&
          s !== '@aws/create-nx-workspace@1.0.0-rc.61',
      );
      const r = registry(present);
      await backfillMissing(PKGS, TAGS, r.io);
      expect(r.publishFromTag).toHaveBeenCalledTimes(2);
    });

    it('B4: should publish a package missing across multiple versions', async () => {
      const present = allPresent().filter(
        (s) =>
          s !== '@aws/nx-plugin-mcp@1.0.0-rc.61' &&
          s !== '@aws/nx-plugin-mcp@1.0.0-rc.60',
      );
      const r = registry(present);
      await backfillMissing(PKGS, TAGS, r.io);
      expect(r.publishFromTag).toHaveBeenCalledTimes(2);
      expect(r.publishFromTag).toHaveBeenCalledWith(
        expect.objectContaining({ name: '@aws/nx-plugin-mcp' }),
        '1.0.0-rc.61',
      );
      expect(r.publishFromTag).toHaveBeenCalledWith(
        expect.objectContaining({ name: '@aws/nx-plugin-mcp' }),
        '1.0.0-rc.60',
      );
    });

    it('B5: should continue past a package that fails to publish and not throw', async () => {
      const present = allPresent().filter(
        (s) =>
          s !== '@aws/nx-plugin@1.0.0-rc.61' &&
          s !== '@aws/nx-plugin-mcp@1.0.0-rc.61',
      );
      const published = new Set(present);
      const logs: string[] = [];
      const publishFromTag = vi.fn(async (pkg: BackfillPackage, v: string) => {
        if (pkg.name === '@aws/nx-plugin') {
          throw new Error('build failed');
        }
        published.add(`${pkg.name}@${v}`);
      });
      await expect(
        backfillMissing(PKGS, TAGS, {
          isPublished: (name: string, v: string) =>
            published.has(`${name}@${v}`),
          publishFromTag,
          onLog: (m) => logs.push(m),
        }),
      ).resolves.toBeUndefined();
      // Both were attempted; the failure was logged, the other still published.
      expect(publishFromTag).toHaveBeenCalledTimes(2);
      expect(published.has('@aws/nx-plugin-mcp@1.0.0-rc.61')).toBe(true);
      expect(
        logs.some((m) => /Could not backfill @aws\/nx-plugin@/.test(m)),
      ).toBe(true);
    });

    it('B7: should ignore a release outside the backfill window', async () => {
      // rc.58 is missing a package but falls outside the newest-3 window.
      const tags = [...TAGS, '1.0.0-rc.58'];
      const r = registry(allPresent()); // nothing for rc.58 present, but out of window
      await backfillMissing(PKGS, tags, r.io);
      expect(r.publishFromTag).not.toHaveBeenCalled();
    });
  });
});
