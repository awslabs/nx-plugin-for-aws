/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { TS_RDB_TRPC_CONNECTION_GENERATOR_INFO } from '../../../ts/rdb/trpc-connection/generator.js';
import {
  addDestructuredImport,
  applyGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { pascalCase } from '../../../utils/names.js';
import type { ComponentMetadata } from '../../../utils/nx.js';

/**
 * Widen the tRPC root `Context` with each connected relational database's
 * context interface.
 *
 * The connection generator vends `src/middleware/<db>.ts` exporting an
 * `I<Db>Context`, but `Context` in `src/init.ts` did not include it, so
 * `t.procedure.concat(create<Db>Plugin())` resolved to tRPC's
 * `TypeError<"Context mismatch">`.
 */

/**
 * The context interface name a connection's middleware file exports, derived
 * from the database name the connection generator recorded (falling back to the
 * middleware file's own name).
 */
const contextInterfaceFor = (connection: ComponentMetadata): string => {
  const name =
    connection.name ?? connection.path!.split('/').pop()!.replace(/\.ts$/, '');
  return `I${pascalCase(name)}Context`;
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const project of getProjects(tree).values()) {
    const components =
      (project.metadata as { components?: ComponentMetadata[] })?.components ??
      [];
    const connections = components.filter(
      (component) =>
        component.generator === TS_RDB_TRPC_CONNECTION_GENERATOR_INFO.id &&
        component.path,
    );
    if (connections.length === 0) {
      continue;
    }

    const initPath = joinPathFragments(project.root, 'src', 'init.ts');
    if (!tree.exists(initPath)) {
      nextSteps.push(
        `${project.name}: no src/init.ts found — manually add each connected database's \`I<Db>Context\` (exported from src/middleware/<db>.ts) to the tRPC root \`Context\` type so procedures can compose the generated plugins.`,
      );
      continue;
    }

    // Only the shape the tRPC generator vends: `export type Context = ...;`
    if (!(await matchGritQL(tree, initPath, '`export type Context = $_;`'))) {
      nextSteps.push(
        `${initPath}: no \`export type Context = ...;\` declaration found - left as-is. Manually add ${connections
          .map((connection) => `\`${contextInterfaceFor(connection)}\``)
          .join(', ')} to the context passed to \`initTRPC.context<...>()\`.`,
      );
      continue;
    }

    for (const connection of connections) {
      const middlewarePath = connection.path!;
      if (!tree.exists(joinPathFragments(project.root, middlewarePath))) {
        nextSteps.push(
          `${project.name}: ${middlewarePath} is missing — manually add its \`I<Db>Context\` to the tRPC root \`Context\` in ${initPath} once the middleware is restored.`,
        );
        continue;
      }

      const contextInterface = contextInterfaceFor(connection);
      await applyGritQL(
        tree,
        initPath,
        `\`export type Context = $ctx;\` => \`export type Context = $ctx & ${contextInterface};\` where { $ctx <: not contains \`${contextInterface}\` }`,
      );

      const contextIncludesDb = await matchGritQL(
        tree,
        initPath,
        `\`export type Context = $ctx;\` where { $ctx <: contains \`${contextInterface}\` }`,
      );
      if (contextIncludesDb) {
        const middlewareModule = `./${middlewarePath
          .replace(/^src\//, '')
          .replace(/\.ts$/, '')}.js`;
        await addDestructuredImport(
          tree,
          initPath,
          [contextInterface],
          middlewareModule,
        );
      }
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
