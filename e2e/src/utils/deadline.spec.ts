/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import { resolveWithin } from './deadline';

/** A read that resolves after `ms`, standing in for a slow renderer. */
const slowRead = (value: string, ms: number) => () =>
  new Promise<string>((resolve) => {
    setTimeout(() => resolve(value), ms);
  });

describe('resolveWithin', () => {
  it('returns the value of a read that resolves before the deadline', async () => {
    await expect(
      resolveWithin(() => Promise.resolve('title'), 'fallback', 5_000),
    ).resolves.toBe('title');
  });

  it('returns the fallback for a read that outlasts the deadline', async () => {
    await expect(
      resolveWithin(slowRead('title', 500), 'fallback', 10),
    ).resolves.toBe('fallback');
  });

  it('returns the fallback for a read that rejects', async () => {
    await expect(
      resolveWithin(
        () => Promise.reject(new Error('target page is closed')),
        'fallback',
        5_000,
      ),
    ).resolves.toBe('fallback');
  });

  it('returns the fallback for a read that throws before it returns a promise', async () => {
    await expect(
      resolveWithin(
        () => {
          throw new Error('no page');
        },
        'fallback',
        5_000,
      ),
    ).resolves.toBe('fallback');
  });

  it('leaves no rejection unhandled when the read fails after the deadline', async () => {
    const failsLate = () =>
      new Promise<string>((_resolve, reject) => {
        setTimeout(() => reject(new Error('target page is closed')), 50);
      });
    await expect(resolveWithin(failsLate, 'fallback', 5)).resolves.toBe(
      'fallback',
    );
    // Give the late rejection time to arrive: an unhandled one fails the run.
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  it('clears the deadline timer once the read resolves', async () => {
    vi.useFakeTimers();
    try {
      await expect(
        resolveWithin(() => Promise.resolve('title'), 'fallback', 5_000),
      ).resolves.toBe('title');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
