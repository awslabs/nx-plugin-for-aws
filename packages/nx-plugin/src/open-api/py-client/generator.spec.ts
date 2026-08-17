/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { declareDependencies } from '../../utils/declared-dependencies';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import {
  OPEN_API_PY_CLIENT_GENERATOR_INFO,
  openApiPyClientGenerator,
} from './generator';

const sharedConstructsDeclaration = declareDependencies()({
  ts: [...SHARED_CONSTRUCTS_DEPENDENCIES],
});

/** Every file in the tree and its contents, for comparing whole-tree state. */
const snapshotTree = (tree: Tree): Record<string, string | null> => {
  const files: Record<string, string | null> = {};
  const walk = (dir: string) => {
    for (const child of tree.children(dir)) {
      const childPath = dir ? `${dir}/${child}` : child;
      if (tree.isFile(childPath)) {
        files[childPath] = tree.read(childPath, 'utf-8');
      } else {
        walk(childPath);
      }
    }
  };
  walk('');
  return files;
};

const trivialSpec = {
  openapi: '3.0.0',
  info: { title: 'TestApi', version: '1.0.0' },
  paths: {
    '/ping': {
      get: {
        operationId: 'ping',
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'string' } } },
          },
        },
      },
    },
  },
};

describe('openApiPyClientGenerator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('emits the expected files when clientType is "both"', async () => {
    tree.write('openapi.json', JSON.stringify(trivialSpec));
    await openApiPyClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });
    expect(tree.exists('src/generated/__init__.py')).toBe(true);
    expect(tree.exists('src/generated/types.py')).toBe(true);
    expect(tree.exists('src/generated/client.py')).toBe(true);
    expect(tree.exists('src/generated/async_client.py')).toBe(true);
  });

  it('omits async_client.py when clientType is "sync"', async () => {
    tree.write('openapi.json', JSON.stringify(trivialSpec));
    await openApiPyClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
      clientType: 'sync',
    });
    expect(tree.exists('src/generated/client.py')).toBe(true);
    expect(tree.exists('src/generated/async_client.py')).toBe(false);
    // The package must only export what it emitted, or importing it fails.
    const init = tree.read('src/generated/__init__.py', 'utf-8') ?? '';
    expect(init).toContain('from .client import TestApi');
    expect(init).not.toContain('async_client');
  });

  it('omits client.py when clientType is "async"', async () => {
    tree.write('openapi.json', JSON.stringify(trivialSpec));
    await openApiPyClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
      clientType: 'async',
    });
    expect(tree.exists('src/generated/client.py')).toBe(false);
    expect(tree.exists('src/generated/async_client.py')).toBe(true);
    const init = tree.read('src/generated/__init__.py', 'utf-8') ?? '';
    expect(init).toContain('from .async_client import AsyncTestApi');
    expect(init).not.toMatch(/from \.client import/);
  });

  // The errors module is shared by both clients, so it is emitted whichever
  // client flavours are asked for.
  it.each(['sync', 'async', 'both'] as const)(
    'emits importable errors.py for clientType %s',
    async (clientType) => {
      tree.write('openapi.json', JSON.stringify(trivialSpec));
      await openApiPyClientGenerator(tree, {
        openApiSpecPath: 'openapi.json',
        outputPath: 'src/generated',
        clientType,
      });
      const errors = tree.read('src/generated/errors.py', 'utf-8') ?? '';
      expect(errors).toContain('class ApiError(Exception)');
      expect(errors).toContain('class PingApiError(ApiError)');
    },
  );

  it('adds generator metric to app.ts', async () => {
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      sharedConstructsDeclaration,
    );
    tree.write('openapi.json', JSON.stringify(trivialSpec));
    await openApiPyClientGenerator(tree, {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    });
    expectHasMetricTags(tree, OPEN_API_PY_CLIENT_GENERATOR_INFO.metric);
  });

  // Running a generator twice must leave the workspace as the first run did:
  // the client is regenerated on every build, so anything that accumulated
  // (a duplicated `.gitignore` entry, a repeated metric) would grow unbounded.
  it('should be idempotent when re-run with the same options', async () => {
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      sharedConstructsDeclaration,
    );
    tree.write('openapi.json', JSON.stringify(trivialSpec));
    const options = {
      openApiSpecPath: 'openapi.json',
      outputPath: 'src/generated',
    };

    await openApiPyClientGenerator(tree, options);
    const afterFirstRun = snapshotTree(tree);

    await openApiPyClientGenerator(tree, options);
    const afterSecondRun = snapshotTree(tree);

    expect(afterSecondRun).toEqual(afterFirstRun);
    // Spelled out separately: these are the entries a second run would append
    // to rather than overwrite, so an equality check alone could mask a change
    // in how they are assembled.
    expect(
      (tree.read('.gitignore', 'utf-8') ?? '')
        .split('\n')
        .filter((line) => line.trim() === 'src/generated'),
    ).toHaveLength(1);
    expectHasMetricTags(tree, OPEN_API_PY_CLIENT_GENERATOR_INFO.metric);
  });
});
