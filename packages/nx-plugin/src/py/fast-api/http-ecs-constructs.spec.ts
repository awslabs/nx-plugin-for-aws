/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type Tree, updateJson } from '@nx/devkit';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../utils/test.js';
import { pyFastApiProjectGenerator } from './generator.js';
import type { PyFastApiProjectGeneratorSchema } from './schema';

const CONSTRUCTS_SRC = 'packages/common/constructs/src';

// Temp files sit next to this spec so `aws-cdk-lib` and `constructs` resolve
// from the workspace root `node_modules`; `_tmp_*` is git-ignored.
const TMP_DIR = join(import.meta.dirname, `_tmp_http-ecs-${process.pid}`);

/**
 * Stands in for the metadata the `openapi` target generates from the API's
 * spec at build time, which the construct derives its routes from.
 */
const METADATA_STUB = `export const OPERATION_DETAILS = {
  echo: { path: '/echo', method: 'GET' },
} as const;

export type Operations = keyof typeof OPERATION_DETAILS;
`;

const generatorOptions = (
  auth: PyFastApiProjectGeneratorSchema['auth'],
): PyFastApiProjectGeneratorSchema => ({
  name: 'test-api',
  directory: 'apps',
  infra: 'http-ecs',
  integrationPattern: 'shared',
  auth,
  iac: 'cdk',
});

const readOrThrow = (tree: Tree, path: string): string => {
  const content = tree.read(path, 'utf-8');
  if (content === null) {
    throw new Error(`Not rendered: ${path}`);
  }
  return content;
};

describe('vended FastAPI http-ecs constructs compile', () => {
  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  const compile = async (
    auth: PyFastApiProjectGeneratorSchema['auth'],
    format: 'esm' | 'cjs',
  ): Promise<string[]> => {
    const tree = createTreeUsingTsSolutionSetup();
    if (format === 'cjs') {
      updateJson(tree, 'package.json', (json) => ({
        ...json,
        type: 'commonjs',
      }));
    }
    await pyFastApiProjectGenerator(tree, generatorOptions(auth));

    const srcDir = join(TMP_DIR, `${auth}-${format}`, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(TMP_DIR, `${auth}-${format}`, 'package.json'),
      JSON.stringify({ type: format === 'esm' ? 'module' : 'commonjs' }),
    );

    const rootNames: string[] = [];
    const walk = (treePath: string): string[] =>
      tree.isFile(treePath)
        ? [treePath]
        : tree.children(treePath).flatMap((c) => walk(`${treePath}/${c}`));
    for (const treePath of walk(CONSTRUCTS_SRC)) {
      const target = join(srcDir, treePath.slice(CONSTRUCTS_SRC.length + 1));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readOrThrow(tree, treePath));
      rootNames.push(target);
    }
    // Written by the `openapi` target during a build, so it is not in the tree.
    const metadataPath = join(srcDir, 'generated/test-api/metadata.gen.ts');
    mkdirSync(dirname(metadataPath), { recursive: true });
    writeFileSync(metadataPath, METADATA_STUB);
    rootNames.push(metadataPath);

    const program = ts.createProgram(rootNames, {
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      types: ['node'],
    });
    return ts
      .getPreEmitDiagnostics(program)
      .map(
        (d) =>
          `${d.file?.fileName ?? ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
      );
  };

  it.each<[PyFastApiProjectGeneratorSchema['auth'], 'esm' | 'cjs']>([
    ['iam', 'esm'],
    ['cognito', 'esm'],
    ['custom', 'esm'],
    ['iam', 'cjs'],
  ])(
    'should type check with %s auth as %s',
    async (auth, format) => {
      expect(await compile(auth, format)).toEqual([]);
    },
    180_000,
  );
});
