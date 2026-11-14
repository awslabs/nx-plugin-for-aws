/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  logger,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import {
  addDestructuredImport,
  addStarExport,
  applyGritQL,
  GRIT_INSERT_PLACEHOLDER,
  insertViaGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import type { Iac } from '../../../utils/iac.js';
import { isEsmWorkspace } from '../../../utils/module-format.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../../utils/shared-constructs-constants.js';

const GUIDE_URL =
  'https://awslabs.github.io/nx-plugin-for-aws/en/guides/react-website-auth-idp/';

const CDK_CORE_DIR = joinPathFragments(
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  'src',
  'core',
);
export const USER_IDENTITY_CDK_FILE = joinPathFragments(
  CDK_CORE_DIR,
  'user-identity.ts',
);
const OIDC_MODULE = './oidc-identity-providers.js';

const CDK_PROP = `/**
   * OpenID Connect identity providers users can sign in through, next to the user pool's own sign-in.
   * Applies to every website that uses this user pool.
   *
   * @example
   * [{ name: 'Okta', issuerUrl: 'https://example.okta.com', clientId: '0oa1example', clientSecretName: 'okta-oidc-client-secret' }]
   *
   * @default no identity providers
   */
  readonly oidcIdentityProviders?: OidcIdentityProviderProps[];`;

const CDK_DESTRUCTURE = 'oidcIdentityProviders = []';

const CDK_STATEMENT = `new OidcIdentityProviders(this, 'OidcIdentityProviders', {
      userPool: this.userPool,
      userPoolDomain: this.userPoolDomain,
      providers: oidcIdentityProviders,
    });`;

const CDK_CREATE_CLIENT =
  '`this.userPoolClient = this.createUserPoolClient(this.userPool);`';

/** One idempotent edit to user-identity.ts: whether it is applied, and how to apply it. */
interface CdkEdit {
  isApplied: (tree: Tree) => Promise<boolean>;
  apply: (tree: Tree) => Promise<boolean>;
}

const CDK_EDITS: CdkEdit[] = [
  {
    isApplied: (tree) =>
      matchGritQL(
        tree,
        USER_IDENTITY_CDK_FILE,
        `\`import { $_ } from '${moduleSpecifier(tree)}'\``,
      ),
    apply: async (tree) => {
      await addDestructuredImport(
        tree,
        USER_IDENTITY_CDK_FILE,
        ['OidcIdentityProviders', 'type OidcIdentityProviderProps'],
        OIDC_MODULE,
      );
      return true;
    },
  },
  {
    isApplied: async (tree) =>
      /\breadonly oidcIdentityProviders\??:/.test(
        tree.read(USER_IDENTITY_CDK_FILE, 'utf-8'),
      ),
    apply: (tree) =>
      insertViaGritQL(
        tree,
        USER_IDENTITY_CDK_FILE,
        `\`export interface UserIdentityProps { $body }\` => \`export interface UserIdentityProps {\n  $body\n\n  ${GRIT_INSERT_PLACEHOLDER}\n}\``,
        CDK_PROP,
      ),
  },
  {
    isApplied: async (tree) =>
      /\boidcIdentityProviders\s*=\s*\[\]/.test(
        tree.read(USER_IDENTITY_CDK_FILE, 'utf-8'),
      ),
    apply: (tree) =>
      applyGritQL(
        tree,
        USER_IDENTITY_CDK_FILE,
        `\`constructor($scope, $id, { $fields }: UserIdentityProps = {}) { $body }\` where { $fields <: [$..., $last], $last += \`, ${CDK_DESTRUCTURE}\` }`,
      ),
  },
  {
    isApplied: (tree) =>
      matchGritQL(
        tree,
        USER_IDENTITY_CDK_FILE,
        '`new OidcIdentityProviders($_)`',
      ),
    apply: (tree) =>
      insertViaGritQL(
        tree,
        USER_IDENTITY_CDK_FILE,
        `${CDK_CREATE_CLIENT} as $s => \`${GRIT_INSERT_PLACEHOLDER}\n    $s\``,
        CDK_STATEMENT,
      ),
  },
];

const moduleSpecifier = (tree: Tree): string =>
  isEsmWorkspace(tree) ? OIDC_MODULE : OIDC_MODULE.replace(/\.js$/, '');

/** The lines to add to user-identity.ts by hand when its shape is not the generated one. */
const cdkManualEditWarning = (tree: Tree): string =>
  `Could not add OpenID Connect identity providers to ${USER_IDENTITY_CDK_FILE}, because the file no longer matches the generated shape. It was left unchanged. Add these to it by hand:

  import { OidcIdentityProviders, type OidcIdentityProviderProps } from '${moduleSpecifier(tree)}';

  // In UserIdentityProps:
  ${CDK_PROP}

  // In the constructor's destructured props:
  ${CDK_DESTRUCTURE},

  // In the constructor, before this.userPoolClient = this.createUserPoolClient(this.userPool);
  ${CDK_STATEMENT}`;

/**
 * Apply every missing edit to user-identity.ts. If one cannot be applied, the
 * file is restored. Returns whether all edits are now in the file.
 */
const addOidcToCdkUserIdentity = async (tree: Tree): Promise<boolean> => {
  if (!tree.exists(USER_IDENTITY_CDK_FILE)) {
    return false;
  }
  const original = tree.read(USER_IDENTITY_CDK_FILE, 'utf-8');
  for (const edit of CDK_EDITS) {
    if (await edit.isApplied(tree)) {
      continue;
    }
    // An edit that matched more than once leaves a placeholder behind.
    if (
      !(await edit.apply(tree)) ||
      !(await edit.isApplied(tree)) ||
      tree
        .read(USER_IDENTITY_CDK_FILE, 'utf-8')
        .includes(GRIT_INSERT_PLACEHOLDER)
    ) {
      tree.write(USER_IDENTITY_CDK_FILE, original);
      return false;
    }
  }
  return true;
};

/** Throw before anything is written if federation cannot be vended for this IaC provider. */
export const assertFederationSupported = (iac: Iac): void => {
  // TODO: vend Terraform federation
  if (iac !== 'cdk') {
    throw new Error(
      `--federation=oidc is not implemented yet for ${iac}. Use --federation=none, or CDK.`,
    );
  }
};

/**
 * Vend OpenID Connect federation for the user identity that ts#website#auth
 * created: the OidcIdentityProviders construct, its export, and the
 * oidcIdentityProviders prop on UserIdentity. The caller formats afterwards.
 */
export const addOidcFederation = async (
  tree: Tree,
  iac: Iac,
): Promise<void> => {
  assertFederationSupported(iac);
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'core'),
    CDK_CORE_DIR,
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  await addStarExport(
    tree,
    joinPathFragments(CDK_CORE_DIR, 'index.ts'),
    OIDC_MODULE,
  );
  if (!(await addOidcToCdkUserIdentity(tree))) {
    logger.warn(cdkManualEditWarning(tree));
  }
};

/** What to do after the generator vended federation. */
export const federationNextSteps = (): string =>
  `OpenID Connect federation is ready to configure. No identity provider is deployed until you add one.

  1. Deploy once. The IdpRedirectUri output of the stack that contains UserIdentity is the redirect URI to register.
  2. Register an application at your identity provider with that redirect URI, and note its client ID and client secret.
  3. Store the client secret in AWS Secrets Manager as a plain string:

       aws secretsmanager create-secret --name okta-oidc-client-secret --secret-string <client secret>

  4. Add the identity provider to UserIdentity in your stack, then deploy:

       new UserIdentity(this, 'Identity', {
         oidcIdentityProviders: [
           {
             name: 'Okta',
             issuerUrl: 'https://example.okta.com',
             clientId: '<client id>',
             clientSecretName: 'okta-oidc-client-secret',
           },
         ],
       });

Anyone an identity provider signs in for this application can sign in to every website that uses this user pool, and gets the identity pool's authenticated role, whatever allowSignup says. Limit who can sign in at the identity provider, as ${GUIDE_URL}#who-can-sign-in describes.

See ${GUIDE_URL}`;
