/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Tree } from '@nx/devkit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tsInfraGenerator } from '../infra/app/generator.js';
import tsProjectGenerator from '../ts/lib/generator.js';
import {
  addCdkTestGlobalSetup,
  CDK_TEST_GLOBAL_SETUP,
  CDK_TEST_GLOBAL_SETUP_ENTRY,
  renderCdkTestGlobalSetup,
} from './cdk-test-setup.js';
import { formatFilesInSubtree } from './format.js';
import { createTreeUsingTsSolutionSetup } from './test.js';

const VARS = ['TMPDIR', 'TEMP', 'TMP', 'CDK_CONTEXT_JSON'] as const;
type Env = Partial<Record<(typeof VARS)[number], string>>;

interface SetupRun {
  /** The variables right after setup ran. */
  during: Env;
  /** The variables after teardown ran. */
  after: Env;
  /** Whether the per-run directory still existed after teardown. */
  dirExistsAfter: boolean;
}

/**
 * Runs the vended global setup the way vitest does: in the main Node process,
 * before any worker starts. A child process keeps its environment changes away
 * from this test run, and Node 24 runs the TypeScript directly.
 */
const runSetup = (dir: string, env: Env): SetupRun => {
  const setupPath = join(dir, 'global-setup.mts');
  writeFileSync(setupPath, renderCdkTestGlobalSetup());
  const driverPath = join(dir, 'driver.mjs');
  writeFileSync(
    driverPath,
    `import { existsSync } from 'node:fs';
const vars = ${JSON.stringify(VARS)};
const pick = () => Object.fromEntries(vars.filter((v) => v in process.env).map((v) => [v, process.env[v]]));
const { default: setup } = await import(${JSON.stringify(setupPath)});
const teardown = await setup();
const during = pick();
await teardown();
const after = pick();
console.log(JSON.stringify({ during, after, dirExistsAfter: existsSync(during.TMPDIR) }));
`,
  );
  const base = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !(VARS as readonly string[]).includes(name),
    ),
  );
  const stdout = execFileSync(process.execPath, [driverPath], {
    env: { ...base, ...env },
    encoding: 'utf-8',
  });
  return JSON.parse(stdout.trim().split('\n').pop() ?? '{}');
};

describe('cdk test global setup', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'spec-')));
  });

  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  describe('vended global setup', () => {
    it('should point every temp variable at one fresh directory under the original temp dir', () => {
      const run = runSetup(scratch, { TMPDIR: scratch });

      const dir = run.during.TMPDIR ?? '';
      expect(dir.startsWith(join(scratch, 'cdk-test-'))).toBe(true);
      expect(run.during.TEMP).toBe(dir);
      expect(run.during.TMP).toBe(dir);
    });

    it('should skip asset bundling while keeping context the caller set', () => {
      const run = runSetup(scratch, {
        TMPDIR: scratch,
        CDK_CONTEXT_JSON: JSON.stringify({ 'my:key': 'kept' }),
      });

      expect(JSON.parse(run.during.CDK_CONTEXT_JSON ?? '{}')).toEqual({
        'my:key': 'kept',
        'aws:cdk:bundling-stacks': [],
      });
    });

    it('should skip asset bundling when no context was set', () => {
      const run = runSetup(scratch, { TMPDIR: scratch });

      expect(JSON.parse(run.during.CDK_CONTEXT_JSON ?? '{}')).toEqual({
        'aws:cdk:bundling-stacks': [],
      });
    });

    it('should remove the directory on teardown', () => {
      const run = runSetup(scratch, { TMPDIR: scratch });

      expect(run.dirExistsAfter).toBe(false);
    });

    it('should restore set variables and delete unset ones on teardown', () => {
      const env = {
        TMPDIR: scratch,
        TEMP: join(scratch, 'temp'),
        CDK_CONTEXT_JSON: '{"my:key":"kept"}',
      };

      const run = runSetup(scratch, env);

      // TMP was unset before, so it is unset again.
      expect(run.after).toEqual(env);
    });
  });

  describe('addCdkTestGlobalSetup', () => {
    let tree: Tree;
    const root = 'packages/lib';

    beforeEach(async () => {
      tree = createTreeUsingTsSolutionSetup();
      await tsProjectGenerator(tree, { name: 'lib', directory: 'packages' });
    });

    const config = () => tree.read(`${root}/vitest.config.mts`, 'utf-8') ?? '';
    const occurrences = (text: string, search: string) =>
      text.split(search).length - 1;

    it('should write the setup file and register it once', async () => {
      await addCdkTestGlobalSetup(tree, root);
      await formatFilesInSubtree(tree);

      expect(tree.read(`${root}/${CDK_TEST_GLOBAL_SETUP}`, 'utf-8')).toBe(
        renderCdkTestGlobalSetup(),
      );
      expect(
        occurrences(
          config(),
          `globalSetup: ['${CDK_TEST_GLOBAL_SETUP_ENTRY}']`,
        ),
      ).toBe(1);
    });

    it('should leave the tree unchanged when run again', async () => {
      await addCdkTestGlobalSetup(tree, root);
      await formatFilesInSubtree(tree);
      const configAfterFirst = config();
      const setupAfterFirst = tree.read(`${root}/${CDK_TEST_GLOBAL_SETUP}`);

      await addCdkTestGlobalSetup(tree, root);
      await formatFilesInSubtree(tree);

      expect(config()).toBe(configAfterFirst);
      expect(tree.read(`${root}/${CDK_TEST_GLOBAL_SETUP}`)).toEqual(
        setupAfterFirst,
      );
    });

    it('should leave a config that already declares a global setup alone', async () => {
      tree.write(
        `${root}/vitest.config.mts`,
        config().replace('test: {', "test: {\n    globalSetup: ['./mine.ts'],"),
      );
      await formatFilesInSubtree(tree);
      const before = config();

      await addCdkTestGlobalSetup(tree, root);
      await formatFilesInSubtree(tree);

      expect(config()).toBe(before);
    });

    it('should keep the infra vitest config well formed', async () => {
      const infra = createTreeUsingTsSolutionSetup();
      await tsInfraGenerator(infra, { name: 'infra', directory: 'packages' });

      const infraConfig =
        infra.read('packages/infra/vitest.config.mts', 'utf-8') ?? '';
      expect(infraConfig).not.toContain(',,');
      expect(infraConfig).toMatchSnapshot();
    });
  });
});
