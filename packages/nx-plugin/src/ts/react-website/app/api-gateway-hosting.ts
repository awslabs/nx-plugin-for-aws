/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, type Tree } from '@nx/devkit';
import { applyGritQL } from '../../../utils/ast.js';
import { kebabCase } from '../../../utils/names.js';
import { readProjectConfigurationUnqualified } from '../../../utils/nx.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../../utils/shared-constructs-constants.js';
import {
  assertVendedCurrent,
  COGNITO_AUTH_BASE_PATH,
  REST_API_SAME_ACCOUNT_GRANT,
  RUNTIME_CONFIG_BASE_PATH,
  SIGN_OUT_BASE_PATH,
  USER_IDENTITY_CALLBACK_URLS,
} from '../../../utils/vended-shapes.js';

const REST_INFRA = ['rest-lambda', 'serverlessapigatewayrestapi'];

/**
 * Checks that `apiProject` is an API project whose infrastructure is a REST API,
 * which a website can be served through.
 */
export const assertRestApiProject = (tree: Tree, apiProject?: string) => {
  if (!apiProject) {
    throw new Error(
      'apiProject is required when hosting the website through API Gateway',
    );
  }
  const metadata = readProjectConfigurationUnqualified(tree, apiProject)
    .metadata as Record<string, string | undefined> | undefined;
  if (!metadata?.apiName) {
    throw new Error(
      `${apiProject} is not an API project. Generate one with ts#smithy-api, ts#trpc-api or py#fast-api first.`,
    );
  }
  // Smithy APIs record no infra and are always REST APIs
  const infra = (metadata.infra ?? metadata.computeType)?.toLowerCase();
  if (infra === 'none') {
    throw new Error(
      `${apiProject} has no infrastructure (infra 'none'), so there is no REST API to serve the website through`,
    );
  }
  if (infra !== undefined && !REST_INFRA.includes(infra)) {
    throw new Error(
      `A website can only be served through a REST API, but ${apiProject} has infra '${infra}'`,
    );
  }
};

const replaceInFile = (
  tree: Tree,
  path: string,
  replacements: [string | RegExp, string][],
) => {
  if (!tree.exists(path)) {
    return;
  }
  const before = tree.read(path, 'utf-8') ?? '';
  const after = replacements.reduce(
    (content, [from, to]) => content.replaceAll(from, to),
    before,
  );
  if (after !== before) {
    tree.write(path, after);
  }
};

/**
 * Builds the website with a relative base, so the page's `<base href>`, which
 * the website construct sets to the path the API is reached at, decides where
 * it loads from, and makes the router honour it.
 */
export const applyApiGatewayBasePath = async (
  tree: Tree,
  websiteRoot: string,
) => {
  const viteConfigPath = joinPathFragments(websiteRoot, 'vite.config.mts');
  if (tree.exists(viteConfigPath)) {
    // A relative base: the dev server still serves from the root
    await applyGritQL(
      tree,
      viteConfigPath,
      "or { `defineConfig(() => ({ $props }))` where { $props <: not some `base: $_`, $props += `base: './'` }, `defineConfig({ $props })` where { $props <: not some `base: $_`, $props += `base: './'` } }",
    );
  }

  const mainTsxPath = joinPathFragments(websiteRoot, 'src', 'main.tsx');
  if (tree.exists(mainTsxPath)) {
    await applyGritQL(
      tree,
      mainTsxPath,
      `\`createRouter({ $props })\` where {
        $props <: not some \`basepath: $_\`,
        $props += \`basepath: new URL(import.meta.env.BASE_URL, document.baseURI).pathname\`
      }`,
    );
  }

  // Relative URLs in the page resolve against the base path
  replaceInFile(tree, joinPathFragments(websiteRoot, 'index.html'), [
    ['<base href="/" />', '<base href="%BASE_URL%" />'],
  ]);
};

/**
 * Stops when a file another generator vended, which the hosted website relies
 * on, predates what it needs. The plugin's migrations bring such files up to
 * date, so the user is pointed at them rather than the files being edited here.
 */
export const assertHostingFilesCurrent = async (
  tree: Tree,
  websiteRoot: string,
  apiProject: string,
) => {
  const generator = "ts#react-website with hosting 'api-gateway'";
  const components = joinPathFragments(websiteRoot, 'src', 'components');
  await assertVendedCurrent(
    tree,
    joinPathFragments(components, 'RuntimeConfig', 'index.tsx'),
    RUNTIME_CONFIG_BASE_PATH,
    "a runtime config fetch under the app's base path",
    generator,
  );
  await assertVendedCurrent(
    tree,
    joinPathFragments(components, 'CognitoAuth', 'index.tsx'),
    COGNITO_AUTH_BASE_PATH,
    "a sign-in redirect under the app's base path",
    generator,
  );
  const appLayout = joinPathFragments(components, 'AppLayout', 'index.tsx');
  if ((tree.read(appLayout, 'utf-8') ?? '').includes('signoutRedirect(')) {
    await assertVendedCurrent(
      tree,
      appLayout,
      SIGN_OUT_BASE_PATH,
      "sign-out redirects under the app's base path",
      generator,
    );
  }
  const constructsSrc = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
  );
  await assertVendedCurrent(
    tree,
    joinPathFragments(constructsSrc, 'core', 'user-identity.ts'),
    USER_IDENTITY_CALLBACK_URLS,
    "UserIdentity's scan for websites' sign-in callback URLs",
    generator,
  );
  const { apiName } = (readProjectConfigurationUnqualified(tree, apiProject)
    .metadata ?? {}) as { apiName?: string };
  const apiConstruct = joinPathFragments(
    constructsSrc,
    'app',
    'apis',
    `${kebabCase(apiName ?? '')}.ts`,
  );
  if ((tree.read(apiConstruct, 'utf-8') ?? '').includes('grantInvokeAccess(')) {
    await assertVendedCurrent(
      tree,
      apiConstruct,
      REST_API_SAME_ACCOUNT_GRANT,
      'a grantInvokeAccess that names a same-account grantee in its own policy alone',
      generator,
    );
  }
};
