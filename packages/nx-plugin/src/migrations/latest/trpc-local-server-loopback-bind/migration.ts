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
import {
  applyGritQL,
  insertViaGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * `src/local-server.ts` called `.listen(PORT)` with no bind address, so Node
 * listened on every network interface and anyone who could reach the developer's
 * machine could call the API with no authentication. It now reads `HOST`,
 * defaulting to `127.0.0.1`.
 *
 * Break risk: a local server reached from another machine, a virtual machine or
 * a container stops answering. Set `HOST=0.0.0.0` on the `serve` target to get
 * the old behaviour back deliberately.
 *
 * Guardrails:
 * - Pattern-match before writing. Only a single-argument `.listen($port)` on a
 *   `createHTTPServer` call is rewritten; a file that already passes a host, or
 *   has diverged from the generated shape, is reported via `nextSteps` instead.
 * - Idempotent. `.listen($port, $host)` has two arguments, so it no longer
 *   matches once migrated.
 */

/**
 * Generator ids a tRPC API project may have been recorded under. A migration
 * matches the ids workspaces recorded at generation time, which must stay fixed
 * even if the generator's current id changes later. `ts#trpc-api` has never been
 * renamed.
 */
const TRPC_GENERATOR_IDS = ['ts#trpc-api'];

/** The single-argument listen call the generator used to emit. */
const LISTEN_WITHOUT_HOST = '`createHTTPServer($opts).listen($port)` as $call';

const HOST_DECLARATION = `// Loopback, so the local server accepts connections only from this machine.
const HOST = process.env.HOST || '127.0.0.1';`;

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const project of getProjects(tree).values()) {
    const generator = (project.metadata as { generator?: string } | undefined)
      ?.generator;
    if (!generator || !TRPC_GENERATOR_IDS.includes(generator)) {
      continue;
    }

    const localServer = joinPathFragments(
      project.root,
      'src',
      'local-server.ts',
    );
    if (!tree.exists(localServer)) {
      // An API on ECS runs its container's entry point instead, and one
      // generated with infra=none may have had the file removed.
      continue;
    }

    const content = tree.read(localServer, 'utf-8') ?? '';
    if (content.includes('process.env.HOST')) {
      // Already bound through HOST, by this migration or by hand.
      continue;
    }

    if (!(await matchGritQL(tree, localServer, LISTEN_WITHOUT_HOST))) {
      nextSteps.push(
        `${localServer} does not match the single-argument \`.listen(PORT)\` call this version wrote, so it was left alone. Pass a bind address of '127.0.0.1' to its listen call so the local server does not accept connections from other machines.`,
      );
      continue;
    }

    // The host constant goes above the server, so the listen call can read it.
    await insertViaGritQL(
      tree,
      localServer,
      '`createHTTPServer($opts)` => `__GRIT_INSERT_PLACEHOLDER__\ncreateHTTPServer($opts)`',
      HOST_DECLARATION,
    );
    await applyGritQL(
      tree,
      localServer,
      '`createHTTPServer($opts).listen($port)` => `createHTTPServer($opts).listen($port, HOST)`',
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
