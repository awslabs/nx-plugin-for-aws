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
 * - A file this migration rewrites is reported through `nextSteps` as well,
 *   naming the new bind address and the `HOST` escape hatch, so the behaviour
 *   change does not arrive silently in a patch release.
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

/**
 * The log line the generator used to emit, and the one it emits now. Replaced
 * as literal text rather than through GritQL, whose snippets cannot hold a
 * template literal's `${}`.
 */
const LOG_WITHOUT_HOST =
  'console.log(`Local TRPC server listening on port ${PORT}`);';
const LOG_WITH_HOST =
  'console.log(`Local TRPC server listening on ${HOST}:${PORT}`);';

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
        `${localServer} does not match the single-argument \`.listen(PORT)\` call this version wrote, so it was left alone. If its listen call already names a bind address, check that address is what you want: '127.0.0.1' accepts connections only from this machine, while '0.0.0.0' accepts them from anywhere that can reach it. If it names none, add '127.0.0.1'.`,
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
    // The address is the thing this changed, so the log line names it, which
    // also leaves a migrated file matching a freshly generated one. A file
    // whose log line was edited keeps it: the text below does not appear.
    const migrated = tree.read(localServer, 'utf-8') ?? '';
    if (migrated.includes(LOG_WITHOUT_HOST)) {
      tree.write(
        localServer,
        migrated.replace(LOG_WITHOUT_HOST, LOG_WITH_HOST),
      );
    }

    // A rewritten file is reported too. This ships as a patch, and a local
    // server reached from a virtual machine or another machine would otherwise
    // stop answering with nothing said about why.
    nextSteps.push(
      `${localServer} now binds the local server to 127.0.0.1, so it accepts connections only from this machine. If you reach it from a virtual machine, a container or another machine, set HOST=0.0.0.0 on the project's serve target to get the old behaviour back.`,
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
