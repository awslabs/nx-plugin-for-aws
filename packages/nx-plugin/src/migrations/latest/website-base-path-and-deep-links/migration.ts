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
import { insertViaGritQL, matchGritQL } from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  COGNITO_AUTH_BASE_PATH,
  RUNTIME_CONFIG_BASE_PATH,
  SIGN_OUT_BASE_PATH,
} from '../../../utils/vended-shapes.js';

/**
 * A React website's vended RuntimeConfig, CognitoAuth and sign-out menu used
 * the root path, so a website built with a Vite `base` other than '/' loaded
 * the wrong config and returned from sign-in outside the app. CognitoAuth also
 * dropped the page a user opened when sending them to sign in.
 *
 * At the default base of '/' the redirects are unchanged, so a website hosted
 * on CloudFront behaves as before, apart from keeping deep links.
 *
 * Guardrails: GritQL checks for the shape these files were generated with, and
 * makes each edit. Their doc comments are left as they are. A file that has diverged is reported through
 * `nextSteps` and left alone, and a migrated file no longer matches, so the
 * migration is idempotent.
 */

const BASE_AWARE_REDIRECT =
  "window.location.origin + new URL(import.meta.env.BASE_URL, document.baseURI).pathname.replace(/^\\/$/, '')";

const RUNTIME_CONFIG_EDITS: { rewrite: string; text: string }[] = [
  {
    rewrite:
      '`fetch($url)` where { $url <: r"[\'\\"]/runtime-config\\.json[\'\\"]" } => `fetch(__GRIT_INSERT_PLACEHOLDER__)`',
    text: '`${import.meta.env.BASE_URL}runtime-config.json`',
  },
];

const COGNITO_AUTH_EDITS: { rewrite: string; text: string }[] = [
  {
    rewrite:
      '`redirect_uri: window.location.origin` => `__GRIT_INSERT_PLACEHOLDER__`',
    text: `// The app's base path, resolved against the page's base URL so a relative Vite base
// works too, or just the origin when the app is served from '/'
redirect_uri: ${BASE_AWARE_REDIRECT}`,
  },
  {
    rewrite:
      '`scope: $scope` where { $scope <: r".email openid profile." } => `scope: $scope,\n__GRIT_INSERT_PLACEHOLDER__`',
    text: `// Return to the page the user opened, held in the sign-in state, otherwise to the
// page signed in to, without the sign-in's code and state
onSigninCallback: (user) => {
  // Resolved first, so neither '..' nor a host in the state can leave the app
  const base = new URL(import.meta.env.BASE_URL, document.baseURI).pathname;
  const returnTo =
    typeof user?.state === 'string'
      ? new URL(user.state, window.location.origin)
      : undefined;
  window.history.replaceState(
    null,
    '',
    returnTo?.origin === window.location.origin &&
      returnTo.pathname.startsWith(base)
      ? \`\${returnTo.pathname}\${returnTo.search}\${returnTo.hash}\`
      : window.location.pathname,
  );
}`,
  },
  {
    rewrite: '`auth.signinRedirect();` => `__GRIT_INSERT_PLACEHOLDER__`',
    text: `const { pathname, search, hash } = window.location;
auth.signinRedirect({ state: \`\${pathname}\${search}\${hash}\` });`,
  },
];

const SIGN_OUT_EDITS: { rewrite: string; text: string }[] = [
  {
    rewrite:
      '`post_logout_redirect_uri: window.location.origin` => `post_logout_redirect_uri: __GRIT_INSERT_PLACEHOLDER__`',
    text: BASE_AWARE_REDIRECT,
  },
  {
    rewrite:
      '`redirect_uri: window.location.origin` => `redirect_uri: __GRIT_INSERT_PLACEHOLDER__`',
    text: BASE_AWARE_REDIRECT,
  },
];

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const components = [...getProjects(tree).values()].map((project) =>
    joinPathFragments(
      project.sourceRoot ?? joinPathFragments(project.root, 'src'),
      'components',
    ),
  );
  const diverged = (path: string) =>
    `${path} has changed since it was generated, so it was left alone. If the website is served under a base path, make its runtime config fetch and sign-in redirects use import.meta.env.BASE_URL.`;
  const groups = [
    {
      paths: components.map((dir) =>
        joinPathFragments(dir, 'RuntimeConfig', 'index.tsx'),
      ),
      shape: RUNTIME_CONFIG_BASE_PATH,
      edits: RUNTIME_CONFIG_EDITS,
    },
    {
      paths: components.map((dir) =>
        joinPathFragments(dir, 'CognitoAuth', 'index.tsx'),
      ),
      shape: COGNITO_AUTH_BASE_PATH,
      edits: COGNITO_AUTH_EDITS,
    },
    {
      // Only an AppLayout that has a sign-out menu, as the auth generator adds
      paths: components
        .map((dir) => joinPathFragments(dir, 'AppLayout', 'index.tsx'))
        .filter((path) =>
          (tree.read(path, 'utf-8') ?? '').includes('signoutRedirect('),
        ),
      shape: SIGN_OUT_BASE_PATH,
      edits: SIGN_OUT_EDITS,
    },
  ];
  const nextSteps: string[] = [];
  for (const { paths, shape, edits } of groups) {
    for (const path of paths) {
      if (
        !tree.exists(path) ||
        (await matchGritQL(tree, path, shape.current))
      ) {
        continue;
      }
      const original = tree.read(path, 'utf-8') ?? '';
      let applied = true;
      for (const pattern of shape.old) {
        applied &&= await matchGritQL(tree, path, pattern);
      }
      for (const { rewrite, text } of edits) {
        applied &&= await insertViaGritQL(tree, path, rewrite, text);
      }
      if (!applied) {
        // Left as it was, rather than half migrated
        tree.write(path, original);
        nextSteps.push(diverged(path));
      }
    }
  }
  await formatFilesInSubtree(tree);
  return { nextSteps };
}
