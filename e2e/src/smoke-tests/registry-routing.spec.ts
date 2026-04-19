/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'child_process';
import { describe, expect, it } from 'vitest';

// Verify each package manager routes @aws/* to local verdaccio. Local publishes
// our packages at 0.0.0; public npmjs has real versions (e.g. 0.99.1), so a
// 0.0.0 resolution unambiguously proves the scope-only wiring works.
const LOCAL_VERSION = '0.0.0';

const run = (cmd: string) =>
  execSync(cmd, { encoding: 'utf-8', stdio: 'pipe' }).trim();

describe('smoke test - registry-routing', () => {
  it('npm resolves @aws/nx-plugin locally', () => {
    expect(run('npm view @aws/nx-plugin version')).toContain(LOCAL_VERSION);
  });

  it('pnpm resolves @aws/nx-plugin locally', () => {
    expect(run('pnpm view @aws/nx-plugin version')).toContain(LOCAL_VERSION);
  });

  it('yarn resolves @aws/nx-plugin locally', () => {
    expect(run('yarn info @aws/nx-plugin version')).toContain(LOCAL_VERSION);
  });

  it('bun resolves @aws/nx-plugin locally', () => {
    expect(run('bun pm view @aws/nx-plugin version')).toContain(LOCAL_VERSION);
  });
});
