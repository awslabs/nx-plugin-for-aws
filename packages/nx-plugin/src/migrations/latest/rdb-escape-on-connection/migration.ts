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
import { TS_RDB_GENERATOR_INFO } from '../../../ts/rdb/generator.js';
import {
  applyGritQL,
  captureAllGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * Move the MySQL create-db-user handler's SQL escaping from the pool onto the
 * open connection.
 *
 * mariadb 3.5.5 makes `Pool.escape()` throw ER_ESCAPE_NO_CONNECTION (45066)
 * when the pool has no connection yet, because escaping depends on the
 * session's SQL mode. The handler ts#rdb vended for MySQL escaped the user,
 * host and database name on the pool before opening a connection, so the
 * custom resource fails on deploy. `PoolConnection.escape()` and
 * `escapeId()` behave the same on mariadb 3.5.4 and 3.5.5.
 *
 * Only `src/create-db-user-handler.ts` in each ts#rdb project is touched. It is
 * rewritten only when it still holds the three escape declarations and the
 * `getConnection()` call exactly as the generator wrote them. A handler that
 * still escapes on the pool in any other shape is left alone and reported via
 * `nextSteps`. Handlers that never escape on the pool (Postgres, or already
 * migrated) are left alone.
 */

const HANDLER_PATH = 'src/create-db-user-handler.ts';

/** The pool escape declarations the generator wrote before this change. */
const OLD_DECLARATIONS = [
  'const quotedDbName = pool.escapeId(dbname)',
  'const quotedUser = pool.escape(dbUser)',
  "const quotedHost = pool.escape('%')",
];

/** The statement that opens the connection the escaping moves onto. */
const GET_CONNECTION = 'connection = await pool.getConnection();';

/** The connection escape declarations, inserted after {@link GET_CONNECTION}. */
const NEW_DECLARATIONS = `// Escape on the open connection, which knows the session's escaping mode
const quotedDbName = connection.escapeId(dbname);
const quotedUser = connection.escape(dbUser);
const quotedHost = connection.escape('%');`;

/** Any escape call on the pool, in whatever shape. */
const POOL_ESCAPE_CALL =
  '`pool.$method($_)` where { $method <: or { `escape`, `escapeId` } }';

const divergedNextStep = (filePath: string): string =>
  `${filePath}: it calls pool.escape() or pool.escapeId() in a shape this migration does not recognise, so it was left unchanged. Open a connection first (pool.getConnection()) and call escape()/escapeId() on that connection instead: mariadb 3.5.5 throws "Cannot escape value: the pool has no connection" (45066) otherwise.`;

/** True when the handler still has exactly the shape the generator wrote. */
const hasVendedShape = async (
  tree: Tree,
  filePath: string,
): Promise<boolean> => {
  const poolEscapes = await captureAllGritQL(tree, filePath, POOL_ESCAPE_CALL);
  if (poolEscapes.length !== OLD_DECLARATIONS.length) {
    return false;
  }
  for (const declaration of OLD_DECLARATIONS) {
    if (!(await matchGritQL(tree, filePath, `\`${declaration}\``))) {
      return false;
    }
  }
  const connections = await captureAllGritQL(
    tree,
    filePath,
    `\`${GET_CONNECTION}\``,
  );
  return connections.length === 1;
};

/** Rewrite one handler, or report it when its shape has diverged. */
const migrateHandler = async (
  tree: Tree,
  filePath: string,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(filePath)) {
    return;
  }
  const poolEscapes = await captureAllGritQL(tree, filePath, POOL_ESCAPE_CALL);
  if (poolEscapes.length === 0) {
    return; // Postgres, already migrated, or rewritten by the user.
  }
  if (!(await hasVendedShape(tree, filePath))) {
    nextSteps.push(divergedNextStep(filePath));
    return;
  }

  // Drop the pool escape declarations, then declare them again on the
  // connection right after it is opened.
  await applyGritQL(
    tree,
    filePath,
    `or { ${OLD_DECLARATIONS.map((d) => `\`${d}\``).join(', ')} } => .`,
  );
  await applyGritQL(
    tree,
    filePath,
    `\`${GET_CONNECTION}\` => \`${GET_CONNECTION}\n${NEW_DECLARATIONS}\``,
  );
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const project of getProjects(tree).values()) {
    const generator = (project.metadata as { generator?: string } | undefined)
      ?.generator;
    if (generator === TS_RDB_GENERATOR_INFO.id) {
      await migrateHandler(
        tree,
        joinPathFragments(project.root, HANDLER_PATH),
        nextSteps,
      );
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
