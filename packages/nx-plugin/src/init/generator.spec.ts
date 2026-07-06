/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, readNxJson, type Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import yaml from 'js-yaml';
import { beforeEach, describe, expect, it } from 'vitest';
import { readAwsNxPluginConfig } from '../utils/config/utils';
import { SYNC_GENERATOR_NAME as TS_SYNC_GENERATOR_NAME } from '../ts/sync/generator';
import { initGenerator } from './generator';

const NX_TYPESCRIPT_SYNC_GENERATOR = '@nx/js:typescript-sync';

describe('init generator', () => {
  let tree: Tree;

  beforeEach(() => {
    // Start from a bare Nx workspace (as `create-nx-workspace` would produce),
    // NOT the plugin's test setup — this is the scenario `init` targets.
    tree = createTreeWithEmptyWorkspace();
  });

  it('should record the iac provider in the plugin config', async () => {
    await initGenerator(tree, { iac: 'terraform', containers: 'docker' });
    expect((await readAwsNxPluginConfig(tree)).iac.provider).toBe('terraform');
  });

  it('should record the container engine in the plugin config', async () => {
    await initGenerator(tree, { iac: 'cdk', containers: 'finch' });
    expect((await readAwsNxPluginConfig(tree)).containers.engine).toBe('finch');
  });

  it('should register the sync generators on the compile target', async () => {
    await initGenerator(tree, { iac: 'cdk', containers: 'docker' });
    const syncGenerators =
      readNxJson(tree)?.targetDefaults?.compile?.syncGenerators;
    expect(syncGenerators).toContain(NX_TYPESCRIPT_SYNC_GENERATOR);
    expect(syncGenerators).toContain(TS_SYNC_GENERATOR_NAME);
  });

  it('should create a root tsconfig.json when missing', async () => {
    expect(tree.exists('tsconfig.json')).toBe(false);
    await initGenerator(tree, { iac: 'cdk', containers: 'docker' });
    expect(tree.exists('tsconfig.json')).toBe(true);
  });

  it('should create tsconfig.base.json even when a root tsconfig.json already exists', async () => {
    // A pre-existing root tsconfig.json makes @nx/js initGenerator skip base
    // creation — init must still produce a base so generators don't fail with
    // `Cannot find tsconfig.base.json`. Simulate a workspace that has a root
    // tsconfig.json but no base.
    tree.delete('tsconfig.base.json');
    tree.write(
      'tsconfig.json',
      JSON.stringify({ extends: './tsconfig.base.json', files: [] }),
    );
    await initGenerator(tree, { iac: 'cdk', containers: 'docker' });
    expect(tree.exists('tsconfig.base.json')).toBe(true);
    const base = readJson(tree, 'tsconfig.base.json');
    expect(base.compilerOptions.composite).toBe(true);
    expect(base.compilerOptions.moduleResolution).toBe('nodenext');
  });


  it('should set type module and add convenience scripts', async () => {
    tree.write(
      'package.json',
      JSON.stringify({ name: 'existing', type: 'module' }),
    );
    await initGenerator(tree, { iac: 'cdk', containers: 'docker' });
    const pkg = readJson(tree, 'package.json');
    expect(pkg.type).toBe('module');
    expect(pkg.scripts.build).toBe('nx run-many --target build');
  });

  it('should preserve a CommonJS workspace module format', async () => {
    // No `type` in the root package.json means CommonJS (matching Node) —
    // init must not convert the workspace to ESM, nor introduce a `type`
    // field (frameworks like Next.js change behaviour when one appears).
    tree.write('package.json', JSON.stringify({ name: 'existing' }));
    await initGenerator(tree, { iac: 'cdk', containers: 'docker' });
    expect(readJson(tree, 'package.json').type).toBeUndefined();
  });

  it('should normalise an explicit commonjs type', async () => {
    tree.write(
      'package.json',
      JSON.stringify({ name: 'existing', type: 'commonjs' }),
    );
    await initGenerator(tree, { iac: 'cdk', containers: 'docker' });
    expect(readJson(tree, 'package.json').type).toBe('commonjs');
  });

  it('should allow-list pnpm build scripts', async () => {
    tree.write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    await initGenerator(tree, { iac: 'cdk', containers: 'docker' });
    const workspace = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8')!,
    ) as Record<string, any>;
    expect(workspace.allowBuilds.esbuild).toBe(true);
    expect(workspace.allowBuilds['@swc/core']).toBe(true);
  });

  it('should repair a broken pnpm allowBuilds placeholder', async () => {
    tree.write(
      'pnpm-workspace.yaml',
      "packages:\n  - packages/*\nallowBuilds:\n  esbuild: 'set this to true or false'\n",
    );
    await initGenerator(tree, { iac: 'cdk', containers: 'docker' });
    const workspace = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8')!,
    ) as Record<string, any>;
    expect(workspace.allowBuilds.esbuild).toBe(true);
  });

  it('should not overwrite an existing tsconfig.base.json compiler options', async () => {
    // A workspace with an intentionally different (incompatible) base config —
    // init must NOT rewrite it, since that could break the user's projects.
    tree.write(
      'tsconfig.base.json',
      JSON.stringify({
        compilerOptions: { module: 'commonjs', moduleResolution: 'node' },
      }),
    );
    await initGenerator(tree, { iac: 'cdk', containers: 'docker' });
    const base = readJson(tree, 'tsconfig.base.json');
    expect(base.compilerOptions.module).toBe('commonjs');
  });

  it('should be idempotent when re-run', async () => {
    await initGenerator(tree, { iac: 'cdk', containers: 'docker' });
    const first = tree
      .listChanges()
      .map((c) => `${c.path}:${c.content?.toString()}`)
      .sort();

    await initGenerator(tree, { iac: 'cdk', containers: 'docker' });
    const second = tree
      .listChanges()
      .map((c) => `${c.path}:${c.content?.toString()}`)
      .sort();

    expect(second).toEqual(first);
  });
});
