/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'child_process';
import { withPyVersions } from './versions';

/**
 * Vitest globalSetup that warms uv's tool cache once before any worker spawns,
 * installing the exact pinned ruff the formatter runs. On a cold cache the
 * first uvx call holds an exclusive lock on uv's cache, so parallel workers
 * would otherwise stall racing it. Failure is ignored — the formatter skips
 * ruff when uv is unavailable.
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
