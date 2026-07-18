/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'child_process';

/**
 * Vitest globalSetup that warms uv's tool cache once before any worker spawns.
 *
 * The formatter runs `uvx ruff` per Python file. On a cold cache the first uv
 * invocation takes an exclusive write lock on uv's global cache while it
 * installs ruff; with many parallel workers each racing that lock, generation
 * stalls. Installing ruff once up front means every worker hits a warm cache,
 * where uv only takes shared locks and calls run concurrently without
 * contention. If uv is unavailable the formatter skips ruff anyway, so a
 * failure here is ignored.
 */
export default function setup() {
  try {
    execFileSync('uvx', ['ruff', '--version'], { stdio: 'ignore' });
  } catch {
    // Ignore — the formatter skips ruff when it is unavailable
  }
}
