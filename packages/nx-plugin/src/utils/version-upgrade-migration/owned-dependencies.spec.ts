/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import {
  addProjectConfiguration,
  type ProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { AWS_NX_PLUGIN_CONFIG_FILE_NAME } from '../config/utils';
import { buildGeneratorInfoList } from '../generators';
import { createTreeUsingTsSolutionSetup } from '../test';
import { PY_VERSIONS, TS_VERSIONS } from '../versions';
import {
  generatorsRun,
  ownedDependencies,
  PLUGIN_ROOT,
} from './owned-dependencies';

const addProject = (
  tree: Tree,
  name: string,
  metadata: ProjectConfiguration['metadata'],
) =>
  addProjectConfiguration(tree, name, {
    root: `packages/${name}`,
    metadata,
  });

describe('generatorsRun', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should read the generator that created each project', () => {
    addProject(tree, 'api', { generator: 'ts#trpc-api' } as never);
    addProject(tree, 'lib', { generator: 'ts#project' } as never);

    expect([...generatorsRun(tree)].sort()).toEqual([
      'ts#project',
      'ts#trpc-api',
    ]);
  });

  it('should read the generators that added components', () => {
    addProject(tree, 'lib', {
      generator: 'ts#project',
      components: [{ generator: 'ts#mcp-server' }, { generator: 'ts#agent' }],
    } as never);

    expect([...generatorsRun(tree)].sort()).toEqual([
      'ts#agent',
      'ts#mcp-server',
      'ts#project',
    ]);
  });

  it('should treat the config file as init having run', () => {
    // init creates no project, so nothing else records it.
    tree.write(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'export default {};');

    expect([...generatorsRun(tree)]).toEqual(['init']);
  });

  it('should find nothing in a workspace no generator has touched', () => {
    addProject(tree, 'hand-written', undefined);

    expect([...generatorsRun(tree)]).toEqual([]);
  });
});

describe('ownedDependencies', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should own nothing when no generator has run', async () => {
    const owned = await ownedDependencies(tree);

    expect(owned.ts.size).toBe(0);
    expect(owned.py.size).toBe(0);
  });

  it('should own the dependencies the generators that ran declare', async () => {
    addProject(tree, 'api', { generator: 'ts#trpc-api' } as never);

    const owned = await ownedDependencies(tree);

    expect(owned.ts.has('zod')).toBe(true);
    expect(owned.ts.has('@trpc/server')).toBe(true);
  });

  it('should not own the dependencies of a generator that did not run', async () => {
    addProject(tree, 'api', { generator: 'ts#trpc-api' } as never);

    const owned = await ownedDependencies(tree);

    // Declared only by the Python generators.
    expect(owned.py.has('ruff')).toBe(false);
  });

  it('should own python dependencies declared by python generators', async () => {
    addProject(tree, 'py', { generator: 'py#project' } as never);

    const owned = await ownedDependencies(tree);

    expect(owned.py.has('ruff')).toBe(true);
  });

  it('should union the declarations of every generator that ran', async () => {
    addProject(tree, 'api', { generator: 'ts#trpc-api' } as never);
    addProject(tree, 'py', { generator: 'py#project' } as never);

    const owned = await ownedDependencies(tree);

    expect(owned.ts.has('zod')).toBe(true);
    expect(owned.py.has('ruff')).toBe(true);
  });
});

describe('declaration coverage', () => {
  // A generator that adds vended dependencies must declare them, or the version
  // sync would leave them behind. Generators that add none need no declaration.
  it('should have every generator that adds dependencies declare them', async () => {
    const undeclared: string[] = [];
    for (const info of buildGeneratorInfoList(PLUGIN_ROOT)) {
      const source = readFileSync(`${info.resolvedFactoryPath}.ts`, 'utf-8');
      const addsDependencies = /withVersions\(|withPyVersions\(/.test(source);
      const module = await import(`${info.resolvedFactoryPath}.js`);
      if (addsDependencies && !module.DECLARED_DEPENDENCIES) {
        undeclared.push(info.id);
      }
    }

    expect(undeclared).toEqual([]);
  });

  it('should declare only packages the plugin vends', async () => {
    const unvended: string[] = [];
    for (const info of buildGeneratorInfoList(PLUGIN_ROOT)) {
      const { DECLARED_DEPENDENCIES } = await import(
        `${info.resolvedFactoryPath}.js`
      );
      for (const dep of DECLARED_DEPENDENCIES?.ts ?? []) {
        if (!(dep in TS_VERSIONS)) {
          unvended.push(`${info.id}: ${dep}`);
        }
      }
      for (const dep of DECLARED_DEPENDENCIES?.py ?? []) {
        if (!(dep in PY_VERSIONS)) {
          unvended.push(`${info.id}: ${dep}`);
        }
      }
    }

    expect(unvended).toEqual([]);
  });
});
