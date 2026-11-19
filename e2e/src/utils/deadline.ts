/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The value `read()` resolves to, or `fallback` when it has not resolved
 * within `timeoutMs` or it failed.
 *
 * For a read that has no deadline of its own, such as Playwright's
 * `page.title()`, which asks the renderer and waits for as long as it takes.
 * A failure handler that awaits one of those can hang for the whole of the
 * suite's timeout and never throw the error it was called to report.
 *
 * A failure of the read itself, raised before or after the deadline, also
 * gives `fallback`, so the caller sees a value rather than a second error and
 * a late rejection never goes unhandled. The deadline timer is cleared once
 * the race settles, so a read that resolves leaves nothing pending.
 */
export const resolveWithin = async <T>(
  read: () => Promise<T>,
  fallback: T,
  timeoutMs: number,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve()
        .then(read)
        .catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
