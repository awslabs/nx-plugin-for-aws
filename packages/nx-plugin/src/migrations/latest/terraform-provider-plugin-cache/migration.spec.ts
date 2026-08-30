/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { terraformProjectGenerator } from '../../../terraform/project/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const PROJECT = '@proj/infra';
const PROJECT_ROOT = 'packages/infra';
const PLUGIN_CACHE_SCRIPT = `${PROJECT_ROOT}/scripts/plugin-cache.ts`;
/** `packages/infra/src` is three levels below the root that holds `.terraform`. */
const EXPECTED_CACHE_DIR = '../../../.terraform/plugin-cache';

/**
 * A script as today's generator vends it, read from the template — so this suite
 * fails if a template moves on without the migration following it.
 */
const currentTemplate = (script: string) =>
  readFileSync(
    join(
      import.meta.dirname,
      `../../../terraform/project/files/application/scripts/${script}.ts.template`,
    ),
    'utf-8',
  ).replace('<%- stateKeyPrefix %>', 'proj-infra');

/**
 * The `terraform init` call in each vended script, before and after the fix, so
 * the fixture is the shape users are upgrading from rather than something
 * derived.
 */
const PRE_FIX_INIT_CALLS = {
  init: {
    before: "{ cwd: srcDir, stdio: 'inherit' }",
    after: "{ cwd: srcDir, stdio: 'inherit', env: pluginCacheEnv() }",
  },
  bootstrap: {
    before:
      "execFileSync('terraform', ['init'], { cwd: bootstrapDir, stdio: 'inherit' });",
    after: `execFileSync('terraform', ['init'], {
    cwd: bootstrapDir,
    stdio: 'inherit',
    env: pluginCacheEnv(),
  });`,
  },
  'bootstrap-destroy': {
    before:
      "execFileSync('terraform', ['init'], { cwd: bootstrapDir, stdio: 'inherit' });",
    after: `execFileSync('terraform', ['init'], {
    cwd: bootstrapDir,
    stdio: 'inherit',
    env: pluginCacheEnv(),
  });`,
  },
} as const;

/**
 * Generates a terraform project, then reverts what this migration adds back to
 * the shape the pre-fix generator produced.
 */
const generatePreFixProject = async (
  tree: Tree,
  type: 'application' | 'library' = 'application',
) => {
  await terraformProjectGenerator(tree, {
    name: 'infra',
    type,
    directory: 'packages',
  });

  const config = readProjectConfiguration(tree, PROJECT);

  config.targets.test.options.commands = [
    'terraform init -backend=false',
    'terraform test',
  ];
  config.targets.test.options.env = {
    TF_DATA_DIR: '../../../dist/{projectRoot}/terraform-test',
  };

  if (type === 'library') {
    // A library's `init` ran `terraform init` inline as a single `command`.
    config.targets.init = {
      executor: 'nx:run-commands',
      defaultConfiguration: 'dev',
      configurations: { dev: { command: 'terraform init' } },
      options: { forwardAllArgs: true, cwd: '{projectRoot}/src' },
    };
  }

  updateProjectConfiguration(tree, PROJECT, config);

  if (type === 'application') {
    tree.delete(PLUGIN_CACHE_SCRIPT);
    // The scripts as vended before the fix: the same `terraform init` calls,
    // without the shared cache.
    for (const [script, call] of Object.entries(PRE_FIX_INIT_CALLS)) {
      const path = `${PROJECT_ROOT}/scripts/${script}.ts`;
      tree.write(
        path,
        tree
          .read(path, 'utf-8')!
          .replace(call.after, call.before)
          .replace("import { pluginCacheEnv } from './plugin-cache';\n", ''),
      );
    }
  }
};

describe('terraform-provider-plugin-cache migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when the workspace has no terraform project', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('should start from a fixture that lacks the cache', async () => {
    // Guards the fixture: without this the assertions below could pass without
    // the migration doing anything.
    await generatePreFixProject(tree);
    const { test } = readProjectConfiguration(tree, PROJECT).targets;
    expect(test.options.env.TF_PLUGIN_CACHE_DIR).toBeUndefined();
    expect(test.options.commands).not.toContainEqual(
      expect.objectContaining({ command: expect.stringContaining('make-dir') }),
    );
  });

  it('should point the test target at the shared plugin cache', async () => {
    await generatePreFixProject(tree);

    const result = await migration(tree);

    const { test } = readProjectConfiguration(tree, PROJECT).targets;
    expect(test.options.env.TF_PLUGIN_CACHE_DIR).toBe(EXPECTED_CACHE_DIR);
    // TF_DATA_DIR still keeps `test`'s own `.terraform` out of `src`.
    expect(test.options.env.TF_DATA_DIR).toBe(
      '../../../dist/{projectRoot}/terraform-test',
    );
    // The cache dir has to exist or terraform falls back to downloading.
    expect(test.options.commands[0]).toEqual({
      command: `make-dir ${EXPECTED_CACHE_DIR}`,
      forwardAllArgs: false,
    });
    expect(test.options.commands.slice(1)).toEqual([
      'terraform init -backend=false',
      'terraform test',
    ]);
    // `make-dir` has to complete before `terraform init` reads the cache.
    expect(test.options.parallel).toBe(false);
    expect(result.nextSteps).toEqual([]);
  });

  it("should migrate a library's inline init command", async () => {
    await generatePreFixProject(tree, 'library');

    const result = await migration(tree);

    const { init } = readProjectConfiguration(tree, PROJECT).targets;
    expect(init.options.env.TF_PLUGIN_CACHE_DIR).toBe(EXPECTED_CACHE_DIR);
    expect(init.configurations.dev.commands).toEqual([
      { command: `make-dir ${EXPECTED_CACHE_DIR}`, forwardAllArgs: false },
      'terraform init',
    ]);
    // Normalised into `commands`, so `make-dir` can run ahead of it.
    expect(init.configurations.dev.command).toBeUndefined();
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a script-driven init target alone', async () => {
    // An application's `init` delegates to the vended script, which reads the
    // cache from its own helper rather than from the target's env.
    await generatePreFixProject(tree);

    const result = await migration(tree);

    const { init } = readProjectConfiguration(tree, PROJECT).targets;
    expect(init.options.env).toBeUndefined();
    expect(init.options.commands).toEqual([
      'tsx {projectRoot}/scripts/init.ts {projectRoot}',
    ]);
    expect(result.nextSteps).toEqual([]);
  });

  it('should vend the plugin-cache helper the scripts import', async () => {
    await generatePreFixProject(tree);

    await migration(tree);

    const script = tree.read(PLUGIN_CACHE_SCRIPT, 'utf-8');
    expect(script).toContain('TF_PLUGIN_CACHE_DIR');
    expect(script).toContain(
      "join(process.cwd(), '.terraform', 'plugin-cache')",
    );
    // Created because terraform errors and re-downloads when it is missing.
    expect(script).toContain('mkdirSync');
  });

  it('should produce exactly what the current generator vends', async () => {
    await generatePreFixProject(tree);

    const result = await migration(tree);

    // The point of a migration: the scripts end up byte-identical to a
    // workspace generated from today's generators.
    for (const script of Object.keys(PRE_FIX_INIT_CALLS)) {
      expect(tree.read(`${PROJECT_ROOT}/scripts/${script}.ts`, 'utf-8')).toBe(
        currentTemplate(script),
      );
    }
    expect(result.nextSteps).toEqual([]);
  });

  it('should skip and report a script whose init call has diverged', async () => {
    await generatePreFixProject(tree);
    const path = `${PROJECT_ROOT}/scripts/bootstrap.ts`;
    tree.write(
      path,
      tree
        .read(path, 'utf-8')!
        .replace(
          "execFileSync('terraform', ['init'], { cwd: bootstrapDir, stdio: 'inherit' });",
          'await myOwnInit({ cwd: bootstrapDir });',
        ),
    );

    const result = await migration(tree);

    expect(tree.read(path, 'utf-8')).toContain('await myOwnInit(');
    expect(tree.read(path, 'utf-8')).not.toContain('pluginCacheEnv');
    expect(result.nextSteps).toContainEqual(expect.stringContaining(path));
  });

  it('should migrate a customised script without disturbing the customisation', async () => {
    await generatePreFixProject(tree);
    const path = `${PROJECT_ROOT}/scripts/bootstrap.ts`;
    tree.write(
      path,
      tree
        .read(path, 'utf-8')!
        .replace(
          "execFileSync('terraform', ['init'], { cwd: bootstrapDir, stdio: 'inherit' });",
          "execFileSync('terraform', ['init'], { cwd: bootstrapDir, stdio: 'inherit' });\n\n  // our team pins a workspace before applying\n  execFileSync('terraform', ['workspace', 'select', 'ops'], { cwd: bootstrapDir, stdio: 'inherit' });",
        ),
    );

    const result = await migration(tree);
    const migrated = tree.read(path, 'utf-8') ?? '';

    expect(migrated).toContain('env: pluginCacheEnv()');
    expect(migrated).toContain("'workspace', 'select', 'ops'");
    expect(migrated).toContain('// our team pins a workspace before applying');
    expect(result.nextSteps).toEqual([]);
  });

  it('should preserve a customised plugin-cache helper', async () => {
    await generatePreFixProject(tree);
    tree.write(PLUGIN_CACHE_SCRIPT, '// mine\n');

    await migration(tree);

    expect(tree.read(PLUGIN_CACHE_SCRIPT, 'utf-8')).toBe('// mine\n');
  });

  it('should skip and report a test target that no longer runs terraform init', async () => {
    await generatePreFixProject(tree);
    const config = readProjectConfiguration(tree, PROJECT);
    config.targets.test.options.commands = ['./scripts/my-own-test.sh'];
    updateProjectConfiguration(tree, PROJECT, config);

    const result = await migration(tree);

    const { test } = readProjectConfiguration(tree, PROJECT).targets;
    expect(test.options.commands).toEqual(['./scripts/my-own-test.sh']);
    expect(test.options.env.TF_PLUGIN_CACHE_DIR).toBeUndefined();
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain(PROJECT);
    expect(result.nextSteps[0]).toContain('TF_PLUGIN_CACHE_DIR');
  });

  it('should preserve a cache dir the user already chose', async () => {
    await generatePreFixProject(tree);
    const config = readProjectConfiguration(tree, PROJECT);
    config.targets.test.options.env.TF_PLUGIN_CACHE_DIR = '/mnt/tf-cache';
    updateProjectConfiguration(tree, PROJECT, config);

    const result = await migration(tree);

    const { test } = readProjectConfiguration(tree, PROJECT).targets;
    expect(test.options.env.TF_PLUGIN_CACHE_DIR).toBe('/mnt/tf-cache');
    expect(test.options.commands).toEqual([
      'terraform init -backend=false',
      'terraform test',
    ]);
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    await generatePreFixProject(tree);

    await migration(tree);
    const afterFirst = readProjectConfiguration(tree, PROJECT);
    const scriptAfterFirst = tree.read(PLUGIN_CACHE_SCRIPT, 'utf-8');

    const result = await migration(tree);

    expect(readProjectConfiguration(tree, PROJECT)).toEqual(afterFirst);
    expect(tree.read(PLUGIN_CACHE_SCRIPT, 'utf-8')).toBe(scriptAfterFirst);
    expect(result.nextSteps).toEqual([]);
  });

  it('should be a no-op on a project generated with the cache already', async () => {
    await terraformProjectGenerator(tree, {
      name: 'infra',
      type: 'application',
      directory: 'packages',
    });
    const before = readProjectConfiguration(tree, PROJECT);

    const result = await migration(tree);

    expect(readProjectConfiguration(tree, PROJECT)).toEqual(before);
    expect(result.nextSteps).toEqual([]);
  });
});
