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
import { SIGV4_CUSTOM_DOMAINS } from '../../../utils/vended-shapes.js';

/**
 * The vended `useSigV4` hook let aws4fetch infer the service and region from a
 * request's hostname, which it cannot behind a custom domain, so API Gateway
 * refused the signature. It now names execute-api in the identity pool's region
 * for any host outside amazonaws.com.
 *
 * Guardrails: GritQL checks for the shape this hook was generated with, and
 * makes each edit. A hook that has diverged is reported through
 * `nextSteps` and left alone, and a migrated hook no longer matches, so the
 * migration is idempotent.
 */
const EDITS: { rewrite: string; text?: string }[] = [
  {
    rewrite:
      '`const sigv4Fetch: $type = $value;` => `__GRIT_INSERT_PLACEHOLDER__\n\nconst sigv4Fetch: $type = $value;`',
    text: `// aws4fetch infers the service and region from an AWS hostname. Behind a custom
// domain it can infer neither, so name API Gateway in the identity pool's region.
const signingScope = useCallback(
  (input: RequestInfo | URL | AwsSignInput) => {
    const { hostname } = new URL(
      input instanceof Request ? input.url : input.toString(),
      window.location.href,
    );
    return !cognitoProps || hostname.endsWith('.amazonaws.com')
      ? {}
      : { service: 'execute-api', region: cognitoProps.region };
  },
  [cognitoProps],
);`,
  },
  {
    rewrite:
      '`awsClient.fetch(input, init)` => `awsClient.fetch(input, { ...init, aws: signingScope(input) })`',
  },
  {
    rewrite:
      '`awsClient.sign(input, init)` => `awsClient.sign(input, { ...init, aws: { ...signingScope(input), ...init?.aws } })`',
  },
  {
    rewrite:
      '`[skipSigning, getAwsClient]` => `[skipSigning, getAwsClient, signingScope]`',
  },
];

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const paths = [...getProjects(tree).values()].map((project) =>
    joinPathFragments(
      project.sourceRoot ?? joinPathFragments(project.root, 'src'),
      'hooks',
      'useSigV4.tsx',
    ),
  );
  const nextSteps: string[] = [];
  for (const path of paths) {
    if (
      !tree.exists(path) ||
      (await matchGritQL(tree, path, SIGV4_CUSTOM_DOMAINS.current))
    ) {
      continue;
    }
    const original = tree.read(path, 'utf-8') ?? '';
    let applied = true;
    for (const pattern of SIGV4_CUSTOM_DOMAINS.old) {
      applied &&= await matchGritQL(tree, path, pattern);
    }
    for (const { rewrite, text } of EDITS) {
      applied &&=
        text === undefined
          ? await applyGritQL(tree, path, rewrite)
          : await insertViaGritQL(tree, path, rewrite, text);
    }
    if (!applied) {
      // Left as it was, rather than half migrated
      tree.write(path, original);
      nextSteps.push(
        `${path} has changed since it was generated, so it was left alone. To sign calls behind a custom domain, pass { service: 'execute-api', region } to aws4fetch for hosts outside amazonaws.com.`,
      );
    }
  }
  await formatFilesInSubtree(tree);
  return { nextSteps };
}
