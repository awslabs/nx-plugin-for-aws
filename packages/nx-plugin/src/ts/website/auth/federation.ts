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
  SHARED_TERRAFORM_DIR,
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

/** One idempotent edit to a vended file: whether it is applied, and how to apply it. */
interface FileEdit {
  filePath: string;
  isApplied: (tree: Tree) => Promise<boolean>;
  apply: (tree: Tree) => Promise<boolean>;
}

const CDK_EDITS: FileEdit[] = [
  {
    filePath: USER_IDENTITY_CDK_FILE,
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
    filePath: USER_IDENTITY_CDK_FILE,
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
    filePath: USER_IDENTITY_CDK_FILE,
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
    filePath: USER_IDENTITY_CDK_FILE,
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

const TF_USER_IDENTITY_DIR = joinPathFragments(
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
  'src',
  'core',
  'user-identity',
);
const USER_IDENTITY_TF_MAIN_FILE = joinPathFragments(
  TF_USER_IDENTITY_DIR,
  'main.tf',
);
const USER_IDENTITY_TF_IDENTITY_FILE = joinPathFragments(
  TF_USER_IDENTITY_DIR,
  'identity',
  'identity.tf',
);

const TF_MODULE_ARGUMENT =
  'oidc_identity_providers = var.oidc_identity_providers';

const TF_CLIENT_PROVIDERS =
  'concat(["COGNITO"], [for p in aws_cognito_identity_provider.oidc : p.provider_name])';

const TF_EDITS: FileEdit[] = [
  {
    filePath: USER_IDENTITY_TF_MAIN_FILE,
    isApplied: async (tree) =>
      /\boidc_identity_providers\s*=\s*var\.oidc_identity_providers\b/.test(
        tree.read(USER_IDENTITY_TF_MAIN_FILE, 'utf-8'),
      ),
    // Appended after the last generated argument of module "identity".
    apply: (tree) =>
      insertViaGritQL(
        tree,
        USER_IDENTITY_TF_MAIN_FILE,
        `language hcl\n\`mfa_second_factor_sms = var.mfa_second_factor_sms\` as $a where { $a <: within \`module "identity" { $_ }\`, $a => \`$a\n  ${GRIT_INSERT_PLACEHOLDER}\` }`,
        TF_MODULE_ARGUMENT,
      ),
  },
  {
    filePath: USER_IDENTITY_TF_IDENTITY_FILE,
    isApplied: async (tree) =>
      tree
        .read(USER_IDENTITY_TF_IDENTITY_FILE, 'utf-8')
        .includes(`supported_identity_providers = ${TF_CLIENT_PROVIDERS}`),
    apply: (tree) =>
      insertViaGritQL(
        tree,
        USER_IDENTITY_TF_IDENTITY_FILE,
        `language hcl\n\`supported_identity_providers = ["COGNITO"]\` as $a where { $a <: within \`resource "aws_cognito_user_pool_client" "web_client" { $_ }\`, $a => \`supported_identity_providers = ${GRIT_INSERT_PLACEHOLDER}\` }`,
        TF_CLIENT_PROVIDERS,
      ),
  },
];

/** The lines to change in the user-identity module by hand when its shape is not the generated one. */
const terraformManualEditWarning = (): string =>
  `Could not add OpenID Connect identity providers to the user-identity Terraform module, because ${USER_IDENTITY_TF_MAIN_FILE} or ${USER_IDENTITY_TF_IDENTITY_FILE} no longer matches the generated shape. Both were left unchanged. Make these edits by hand:

  # In module "identity" in ${USER_IDENTITY_TF_MAIN_FILE}:
  ${TF_MODULE_ARGUMENT}

  # In resource "aws_cognito_user_pool_client" "web_client" in ${USER_IDENTITY_TF_IDENTITY_FILE}:
  supported_identity_providers = ${TF_CLIENT_PROVIDERS}`;

/**
 * Apply every missing edit. If one cannot be applied, every edited file is
 * restored. Returns whether all edits are now in place.
 */
const applyEdits = async (tree: Tree, edits: FileEdit[]): Promise<boolean> => {
  const filePaths = [...new Set(edits.map((edit) => edit.filePath))];
  if (!filePaths.every((filePath) => tree.exists(filePath))) {
    return false;
  }
  const originals = filePaths.map(
    (filePath) => [filePath, tree.read(filePath, 'utf-8')] as const,
  );
  for (const edit of edits) {
    if (await edit.isApplied(tree)) {
      continue;
    }
    // An edit that matched more than once leaves a placeholder behind.
    if (
      !(await edit.apply(tree)) ||
      !(await edit.isApplied(tree)) ||
      tree.read(edit.filePath, 'utf-8').includes(GRIT_INSERT_PLACEHOLDER)
    ) {
      for (const [filePath, original] of originals) {
        tree.write(filePath, original);
      }
      return false;
    }
  }
  return true;
};

/** How federation is vended for one IaC provider. */
interface FederationTarget {
  /** Template directory under files/, and where it is written */
  templates: { from: string; to: string };
  edits: FileEdit[];
  manualEditWarning: (tree: Tree) => string;
  /** Vends anything else the new files need */
  extra?: (tree: Tree) => Promise<void>;
}

const FEDERATION_TARGETS: Record<Iac, FederationTarget> = {
  cdk: {
    templates: { from: joinPathFragments('cdk', 'core'), to: CDK_CORE_DIR },
    edits: CDK_EDITS,
    manualEditWarning: cdkManualEditWarning,
    extra: async (tree) => {
      await addStarExport(
        tree,
        joinPathFragments(CDK_CORE_DIR, 'index.ts'),
        OIDC_MODULE,
      );
    },
  },
  terraform: {
    templates: {
      from: joinPathFragments('terraform', 'core', 'user-identity'),
      to: TF_USER_IDENTITY_DIR,
    },
    edits: TF_EDITS,
    manualEditWarning: terraformManualEditWarning,
  },
};

/**
 * Vend OpenID Connect federation for the user identity that ts#website#auth
 * created: the new identity provider files, and the edits that let the user
 * pool's web client list the providers. If the edits cannot be applied, the
 * edited files are left unchanged and a warning lists the lines to add. The
 * caller formats afterwards.
 */
export const addOidcFederation = async (
  tree: Tree,
  iac: Iac,
): Promise<void> => {
  const target = FEDERATION_TARGETS[iac];
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', target.templates.from),
    target.templates.to,
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  await target.extra?.(tree);
  if (!(await applyEdits(tree, target.edits))) {
    logger.warn(target.manualEditWarning(tree));
  }
};

/** The parts of the next steps that differ by IaC provider. */
const NEXT_STEPS: Record<
  Iac,
  { redirectUri: string; addProvider: string; allowSignup: string }
> = {
  cdk: {
    redirectUri:
      'Deploy once. The IdpRedirectUri output of the stack that contains UserIdentity is the redirect URI to register.',
    addProvider: `Add the identity provider to UserIdentity in your stack, then deploy:

       new UserIdentity(this, 'Identity', {
         oidcIdentityProviders: [
           {
             name: 'Okta',
             issuerUrl: 'https://example.okta.com',
             clientId: '<client id>',
             clientSecretName: 'okta-oidc-client-secret',
           },
         ],
       });`,
    allowSignup: 'allowSignup',
  },
  terraform: {
    redirectUri:
      'Add output "idp_redirect_uri" { value = module.user_identity.idp_redirect_uri } to your root module and apply. Its value is the redirect URI to register.',
    addProvider: `Add the identity provider to module "user_identity" in your root module, then apply:

       module "user_identity" {
         source = "../../common/terraform/src/core/user-identity"

         oidc_identity_providers = [
           {
             name               = "Okta"
             issuer_url         = "https://example.okta.com"
             client_id          = "<client id>"
             client_secret_name = "okta-oidc-client-secret"
           },
         ]
       }`,
    allowSignup: 'allow_signup',
  },
};

/** What to do after the generator vended federation. */
export const federationNextSteps = (iac: Iac): string => {
  const { redirectUri, addProvider, allowSignup } = NEXT_STEPS[iac];
  return `OpenID Connect federation is ready to configure. No identity provider is deployed until you add one.

  1. ${redirectUri}
  2. Register an application at your identity provider with that redirect URI, and note its client ID and client secret.
  3. Store the client secret in AWS Secrets Manager as a plain string:

       aws secretsmanager create-secret --name okta-oidc-client-secret --secret-string <client secret>

  4. ${addProvider}

Anyone an identity provider signs in for this application can sign in to every website that uses this user pool, and gets the identity pool's authenticated role, whatever ${allowSignup} says. Limit who can sign in at the identity provider, as ${GUIDE_URL}#who-can-sign-in describes.

See ${GUIDE_URL}`;
};
