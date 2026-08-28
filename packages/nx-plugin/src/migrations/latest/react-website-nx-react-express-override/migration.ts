/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  detectPackageManager,
  type MigrationReturnObject,
  readJson,
  type Tree,
  updateJson,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format';
import { TS_VERSIONS } from '../../../utils/versions';

/**
 * Pin the `express` `@nx/react` resolves to the version generated websites use.
 *
 * `@nx/react` declares an optional `express` peer for its module-federation
 * dev-server, on the major behind the `express` vended here. npm is alone in
 * failing the whole install on an optional peer it cannot satisfy:
 *
 *   npm error ERESOLVE could not resolve
 *   npm error   peerOptional express@"^4.21.2" from @nx/react
 *   npm error Conflicting peer dependency: express@5.2.1
 *
 * so an npm workspace with a website cannot install once its nx moves onto a
 * version carrying that peer. pnpm, bun and yarn only warn, and get nothing.
 *
 * Scoped to `@nx/react` rather than pinning `express` workspace-wide: nothing
 * here loads it, the peer only has to be satisfiable, and a bare override would
 * reach every other consumer of express too.
 *
 * Guardrails:
 * - npm only, and only for a workspace that has a website — the root `@nx/react`
 *   the generator adds. Anything else needs no override.
 * - A user's own `overrides['@nx/react'].express` is left alone: theirs may pin a
 *   version deliberately.
 * - Idempotent: writing the same pin twice is a no-op.
 */
export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  if (detectPackageManager(tree.root) !== 'npm') {
    return { nextSteps };
  }

  const packageJson = readJson<{
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
    overrides?: Record<string, unknown>;
  }>(tree, 'package.json');

  const hasNxReact = Boolean(
    packageJson.devDependencies?.['@nx/react'] ??
      packageJson.dependencies?.['@nx/react'],
  );
  if (!hasNxReact) {
    return { nextSteps }; // No website in this workspace.
  }

  const scoped = packageJson.overrides?.['@nx/react'] as
    | Record<string, string>
    | string
    | undefined;

  // The string form pins `@nx/react` itself, leaving nowhere to nest the peer.
  if (typeof scoped === 'string') {
    nextSteps.push(
      `package.json: overrides['@nx/react'] pins a version as a string, so the express override could not be nested under it - left untouched. npm fails the install on @nx/react's optional express peer, so add { "@nx/react": { ".": "${scoped}", "express": "${TS_VERSIONS.express}" } } to keep it satisfiable.`,
    );
    return { nextSteps };
  }

  if (scoped?.express) {
    return { nextSteps }; // Already pinned, by this migration or by the user.
  }

  updateJson(tree, 'package.json', (json) => ({
    ...json,
    overrides: {
      ...json.overrides,
      '@nx/react': { ...scoped, express: TS_VERSIONS.express },
    },
  }));

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
