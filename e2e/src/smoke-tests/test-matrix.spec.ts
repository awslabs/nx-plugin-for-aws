/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDirSync } from 'fs-extra';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestWorkspace, runCLI, runInstall, tmpProjPath } from '../utils';

/**
 * Exercises `internal#test-matrix`, the plugin's own copy of the generator
 * matrix, which composes the generators in-process on a single tree.
 *
 * The package-manager smoke tests cover the same generators through the CLI, one
 * invocation at a time — the way users run them. This covers the composed path
 * instead, which is what a test upgrading an older workspace uses (it scaffolds
 * with that released version's own matrix). Composing in-process differs enough
 * to be worth its own lane: one tree for every generator, and options resolved
 * from each generator's schema rather than the CLI's defaults.
 *
 * Lives here rather than in the plugin's unit tests because composing every
 * generator takes minutes, well past that suite's 2 minute default.
 */
describe('smoke test - test-matrix', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/test-matrix-${pkgMgr}`;
  let projectRoot: string;

  beforeAll(
    async () => {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { force: true, recursive: true });
      }
      ensureDirSync(targetDir);
      projectRoot = await createTestWorkspace(
        pkgMgr,
        targetDir,
        'matrix-test',
        'cdk',
      );
    },
    15 * 60 * 1000,
  );

  afterAll(() => {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
  });

  it('should scaffold every generator and build the workspace', async () => {
    const opts = {
      cwd: projectRoot,
      env: {
        NX_DAEMON: 'false',
        NODE_OPTIONS: '--max-old-space-size=8192',
      },
    };

    await runCLI(
      `generate @aws/nx-plugin:internal#test-matrix --no-interactive`,
      opts,
    );

    // Since the smoke tests don't run in a git repo, we need to exclude some
    // patterns for the license sync.
    writeFileSync(
      join(projectRoot, 'aws-nx-plugin.config.mts'),
      readFileSync(
        join(__dirname, '../files/aws-nx-plugin.config.mts.template'),
        'utf-8',
      ),
    );

    // Install the full set of dependencies accumulated across the matrix, sync
    // project references, then install again so the manifests sync wrote are
    // resolvable — mirroring what the package-manager smoke tests do.
    await runInstall(opts);
    await runCLI('sync', opts);
    await runInstall(opts);

    const buildOutput = await runCLI(
      'run-many --target build --all --output-style=stream --skip-nx-cache',
      opts,
    );
    expect(buildOutput).toContain('Successfully ran target build');
  });
});
