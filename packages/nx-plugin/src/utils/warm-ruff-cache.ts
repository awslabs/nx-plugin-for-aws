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
 * contention. Both command forms the formatter may use are warmed; if uv is
 * unavailable the formatter skips ruff anyway, so failures here are ignored.
 */
export default function setup() {
  for (const [command, ...args] of [
    ['uv', 'run', 'ruff', '--version'],
    ['uvx', 'ruff', '--version'],
  ]) {
    try {
      execFileSync(command, args, { stdio: 'ignore' });
    } catch {
      // Ignore — the formatter falls back or skips ruff when it is unavailable
    }
  }
}
