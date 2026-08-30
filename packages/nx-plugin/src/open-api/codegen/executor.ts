/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type ExecutorContext, logger, workspaceRoot } from '@nx/devkit';
import { FsTree, flushChanges, printChanges } from 'nx/src/generators/tree.js';
import type { OpenApiCodegenExecutorSchema } from './executor-schema';

/**
 * The generators this executor can run, loaded on demand so a run only pays for
 * the code generation it asks for.
 */
const GENERATORS = {
  'ts-client': () => import('../ts-client/generator.js'),
  'ts-hooks': () => import('../ts-hooks/generator.js'),
  'ts-metadata': () => import('../ts-metadata/generator.js'),
  'json-metadata': () => import('../json-metadata/generator.js'),
} as const;

/**
 * Runs an OpenAPI code generator against the workspace.
 *
 * Generated codegen targets use this rather than shelling out to `nx g`, which
 * pays a second full Nx bootstrap — project graph, plugin resolution and
 * schema validation — for work the running Nx process has already done. The
 * generator is invoked directly against a tree rooted at the workspace, so the
 * output is the same as `nx g` produces, including formatting.
 */
export default async function openApiCodegenExecutor(
  options: OpenApiCodegenExecutorSchema,
  _context: ExecutorContext,
): Promise<{ success: boolean }> {
  const loadGenerator = GENERATORS[options.generator];
  if (!loadGenerator) {
    logger.error(
      `Unknown generator "${options.generator}". Expected one of ${Object.keys(GENERATORS).join(', ')}.`,
    );
    return { success: false };
  }

  const generator = (await loadGenerator()).default;

  const tree = new FsTree(workspaceRoot, false);
  await generator(tree, {
    openApiSpecPath: options.openApiSpecPath,
    outputPath: options.outputPath,
  });

  tree.lock();
  const changes = tree.listChanges();
  printChanges(changes);

  if (options.dryRun) {
    logger.warn('\nNOTE: The "dryRun" flag means no changes were made.');
    return { success: true };
  }

  flushChanges(workspaceRoot, changes);

  return { success: true };
}
