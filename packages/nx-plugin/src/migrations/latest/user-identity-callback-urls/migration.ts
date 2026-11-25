/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import {
  addDestructuredImport,
  insertViaGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../../utils/shared-constructs-constants.js';
import { USER_IDENTITY_CALLBACK_URLS } from '../../../utils/vended-shapes.js';

/**
 * The vended UserIdentity permitted sign-in to return only to the local dev
 * servers and the stack's CloudFront distributions. It gains addCallbackUrl,
 * and permits the callbacks a construct of the plugin's in the stack names
 * under a key only the plugin sets, as a website hosted through API Gateway does.
 *
 * Guardrails: GritQL checks for the shape this construct was generated with,
 * and makes the edits. A construct that has diverged is reported through
 * `nextSteps` and left alone, and a migrated one no longer matches, so the
 * migration is idempotent.
 */
const EDITS: { rewrite: string; text: string }[] = [
  {
    rewrite:
      '`private createUserPoolClient = $client` => `__GRIT_INSERT_PLACEHOLDER__\n\nprivate createUserPoolClient = $client`',
    text: `private readonly additionalCallbackUrls: string[] = [];

/**
 * Permits the web client's sign-in and sign-out to redirect to the given URL,
 * in addition to the local dev servers and any CloudFront distributions in the stack.
 *
 * @param url - The full URL the app redirects to, such as a website served from a custom domain
 */
public addCallbackUrl(url: string) {
  if (!Token.isUnresolved(url)) {
    const { protocol, hostname } = new URL(url);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
    if (protocol !== 'https:' && !(protocol === 'http:' && loopback)) {
      throw new Error(
        \`Callback URL \${url} must use https, or http on a loopback host\`,
      );
    }
  }
  this.additionalCallbackUrls.push(url);
}`,
  },
  {
    rewrite:
      '`LOCAL_CALLBACK_URLS.concat($cloudFront)` where { $cloudFront <: contains `findCloudFrontDomainNames` } => `[...new Set(LOCAL_CALLBACK_URLS.concat(this.additionalCallbackUrls).concat($cloudFront)__GRIT_INSERT_PLACEHOLDER__)]`',
    text: `// Websites served other than by CloudFront, such as through an API
.concat(
  Stack.of(this)
    .node.findAll()
    // Under a key only the plugin's constructs set, so no other construct's property is read
    .flatMap(
      (child) =>
        (child as unknown as Record<symbol, unknown>)[
          Symbol.for('@aws/nx-plugin/sign-in-callback-urls')
        ],
    )
    .filter((url): url is string => typeof url === 'string')
)`,
  },
];

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const path = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
    'core',
    'user-identity.ts',
  );
  const nextSteps: string[] = [];
  if (
    tree.exists(path) &&
    !(await matchGritQL(tree, path, USER_IDENTITY_CALLBACK_URLS.current))
  ) {
    const original = tree.read(path, 'utf-8') ?? '';
    let applied = true;
    for (const pattern of USER_IDENTITY_CALLBACK_URLS.old) {
      applied &&= await matchGritQL(tree, path, pattern);
    }
    for (const { rewrite, text } of EDITS) {
      applied &&= await insertViaGritQL(tree, path, rewrite, text);
    }
    if (applied) {
      await addDestructuredImport(tree, path, ['Token'], 'aws-cdk-lib');
    } else {
      // Left as it was, rather than half migrated
      tree.write(path, original);
      nextSteps.push(
        `${path} has changed since it was generated, so it was left alone. A website hosted through API Gateway, or behind a Verified Access door, needs UserIdentity to permit its sign-in callback: add an addCallbackUrl(url) method that adds to the web client's callback URLs.`,
      );
    }
  }
  await formatFilesInSubtree(tree);
  return { nextSteps };
}
