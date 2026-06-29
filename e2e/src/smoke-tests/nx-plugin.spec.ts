/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDirSync } from 'fs-extra';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTestWorkspace, runCLI, tmpProjPath } from '../utils';

/**
 * Exercises the `ts#nx-plugin` and `ts#nx-generator` generators end-to-end and,
 * crucially, *runs* the generated generator.
 *
 * Nx transpiles an unbuilt plugin generator on the fly. Without
 * `@swc-node/register` it falls back to ts-node, which forces the deprecated
 * `moduleResolution: node10` — a hard error under TypeScript 6. The `ts#nx-plugin`
 * generator therefore adds `@swc-node/register` so nx uses swc instead. This
 * test regresses if that dependency is dropped, since running the generator
 * below would then fail with `TS5107`.
 */
describe('smoke test - nx-plugin', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/nx-plugin-${pkgMgr}`;
  let projectRoot: string;

  beforeAll(async () => {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
    projectRoot = await createTestWorkspace(
      pkgMgr,
      targetDir,
      'nx-plugin-test',
      'cdk',
    );
  }, 15 * 60 * 1000);

  afterAll(() => {
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
  });

  it(
    'should generate a plugin and run its custom generator',
    async () => {
      const opts = { cwd: projectRoot, env: { NX_DAEMON: 'false' } };

      // Generate the Nx plugin and a custom generator within it.
      await runCLI(
        `generate @aws/nx-plugin:ts#nx-plugin --name=plugin --directory=tools --no-interactive`,
        opts,
      );
      await runCLI(
        `generate @aws/nx-plugin:ts#nx-generator --project=@nx-plugin-test/plugin --name=my#generator --no-interactive`,
        opts,
      );

      // Run the generated generator. Nx transpiles it on the fly; this fails
      // under TypeScript 6 unless @swc-node/register is present (otherwise nx
      // falls back to ts-node, which forces deprecated moduleResolution=node10).
      await runCLI(
        `generate @nx-plugin-test/plugin:my#generator --exampleOption=test --no-interactive`,
        opts,
      );

      // The sample generator writes hello.ts into target/dir.
      expect(existsSync(join(projectRoot, 'target/dir/hello.ts'))).toBe(true);
    },
    15 * 60 * 1000,
  );
});
