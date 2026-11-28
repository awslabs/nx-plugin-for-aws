/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Tree } from '@nx/devkit';
import ts from 'typescript';

const CONSTRUCTS_DIR = 'packages/common/constructs';

const listFiles = (tree: Tree, dir: string): string[] =>
  tree.isFile(dir)
    ? [dir]
    : tree.children(dir).flatMap((child) => listFiles(tree, `${dir}/${child}`));

/**
 * Writes the shared constructs vended into `tree` to `outDir`, at their
 * workspace paths, as runnable ES modules beside the TypeScript sources.
 *
 * `outDir` must sit inside this package so `aws-cdk-lib` and `constructs`
 * resolve from its `node_modules`, and the spec must run in the `node`
 * environment, since jsdom resolves `new URL(path, import.meta.url)` to http. `extraFiles`, keyed by workspace path, adds
 * what the constructs reference but no generator vends, such as the generated
 * API metadata or the bundles the assets point at.
 *
 * @returns the absolute paths of the TypeScript sources written, for type checking
 */
export const writeSharedConstructs = (
  tree: Tree,
  outDir: string,
  extraFiles: Record<string, string> = {},
): string[] => {
  const write = (path: string, content: string) => {
    const target = join(outDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    return target;
  };
  write('package.json', JSON.stringify({ type: 'module' }));
  const sources: string[] = [];
  for (const path of listFiles(tree, `${CONSTRUCTS_DIR}/src`)) {
    const content = tree.read(path, 'utf-8') ?? '';
    if (path.endsWith('.ts')) {
      sources.push(write(path, content));
      write(
        path.replace(/\.ts$/, '.js'),
        ts.transpileModule(content, {
          compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
          },
        }).outputText,
      );
    } else {
      write(path, content);
    }
  }
  for (const [path, content] of Object.entries(extraFiles)) {
    const target = write(path, content);
    if (path.endsWith('.ts')) {
      sources.push(target);
    }
  }
  return sources;
};

/** Imports a shared constructs module written by {@link writeSharedConstructs}. */
export const importSharedConstructs = async <T>(
  outDir: string,
  path = 'src/index.js',
): Promise<T> =>
  await import(pathToFileURL(join(outDir, CONSTRUCTS_DIR, path)).href);

/** Type checks the given TypeScript sources, returning any diagnostics. */
export const typeCheck = (sources: string[]): string[] =>
  ts
    .getPreEmitDiagnostics(
      ts.createProgram(sources, {
        strict: true,
        skipLibCheck: true,
        noEmit: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        types: ['node'],
      }),
    )
    .map(
      (d) =>
        `${d.file?.fileName ?? ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
    );
