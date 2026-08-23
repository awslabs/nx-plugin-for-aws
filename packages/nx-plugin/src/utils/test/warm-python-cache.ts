/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'child_process';
import {
  PY_CLIENT_VERIFIER_DEPENDENCIES,
  PY_VERIFIER_TYPE_CHECKER,
} from './python-dependencies';

/**
 * Vitest globalSetup that warms uv's cache once before any worker spawns.
 *
 * `PythonVerifier` starts a `uv run --with …` worker per spec file. On a cold
 * cache the first invocation takes an exclusive write lock while it downloads
 * and installs those packages; with many workers racing that lock, startup
 * stalls and a worker can be torn down before it answers. Installing them once
 * up front means every worker hits a warm cache, where uv only takes shared
 * locks.
 *
 * Mirrors the pre-warm this suite used for `ruff` before it moved in-process.
 * Failures are ignored: a missing `uv` is reported by the verifier itself, with
 * a message naming the tool.
 */
export default function setup() {
  // The same set the verifier installs, so the warm cache is the one it hits.
  const deps = [
    ...PY_CLIENT_VERIFIER_DEPENDENCIES,
    PY_VERIFIER_TYPE_CHECKER,
  ].flatMap((spec) => ['--with', spec]);
  try {
    execFileSync('uv', ['run', ...deps, 'python', '-c', ''], {
      stdio: 'ignore',
    });
  } catch {
    // Ignored — the verifier reports an unavailable uv when a test needs it.
  }
}
