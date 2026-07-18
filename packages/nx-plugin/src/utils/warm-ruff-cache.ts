/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'child_process';
import { withPyVersions } from './versions';

/**
 * Vitest globalSetup that warms uv's tool cache once before any worker spawns.
 *
 * The formatter runs `uvx --from ruff==<version> ruff` per Python file. On a
 * cold cache the first uv invocation takes an exclusive write lock on uv's
 * global cache while it installs ruff; with many parallel workers each racing
 * that lock, generation stalls. Installing ruff once up front means every
 * worker hits a warm cache, where uv only takes shared locks and calls run
 * concurrently without contention. The exact pinned spec the formatter uses is
 * warmed so the warm cache matches. If uv is unavailable the formatter skips
 * ruff anyway, so a failure here is ignored.
 */
export default function setup() {
  const ruff = withPyVersions(['ruff'])[0];
  try {
    execFileSync('uvx', ['--from', ruff, 'ruff', '--version'], {
      stdio: 'ignore',
    });
  } catch {
    // Ignore — the formatter skips ruff when it is unavailable
  }
}
