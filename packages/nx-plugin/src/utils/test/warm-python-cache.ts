/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'child_process';
import { OPEN_API_PY_CLIENT_DEPENDENCIES } from '../../open-api/py-client/generator';
import { declaredNames } from '../declared-dependencies';
import { PY_VERSIONS, withPyVersions } from '../versions';

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
  const deps = withPyVersions(
    OPEN_API_PY_CLIENT_DEPENDENCIES,
    declaredNames(OPEN_API_PY_CLIENT_DEPENDENCIES.py),
  )
    .concat(`ty${PY_VERSIONS.ty}`)
    .flatMap((spec) => ['--with', spec]);
  try {
    execFileSync('uv', ['run', ...deps, 'python', '-c', ''], {
      stdio: 'ignore',
    });
  } catch {
    // Ignored — the verifier reports an unavailable uv when a test needs it.
  }
}
