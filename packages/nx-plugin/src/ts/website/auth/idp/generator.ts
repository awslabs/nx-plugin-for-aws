/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  logger,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import { addStarExport } from '../../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../../utils/format.js';
import { type Iac, resolveIac } from '../../../../utils/iac.js';
import {
  addIdentityProviderToCdkUserIdentity,
  addIdentityProviderToTerraformClient,
  USER_IDENTITY_CDK_FILE,
  USER_IDENTITY_TERRAFORM_FILE,
} from '../../../../utils/identity-constructs/identity-constructs.js';
import { addGeneratorMetricsIfApplicable } from '../../../../utils/metrics.js';
import { isEsmWorkspace } from '../../../../utils/module-format.js';
import {
  getGeneratorInfo,
  type NxGeneratorInfo,
} from '../../../../utils/nx.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../../utils/shared-constructs-constants.js';
import { type IdpOptions, resolveIdpOptions } from './options.js';
import type { TsWebsiteAuthIdpGeneratorSchema } from './schema';

export const TS_WEBSITE_AUTH_IDP_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

const GUIDE_URL =
  'https://awslabs.github.io/nx-plugin-for-aws/en/guides/react-website-auth-idp/';

const CDK_CORE_DIR = joinPathFragments(
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  'src',
  'core',
);
const TERRAFORM_CORE_DIR = joinPathFragments(
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
  'src',
  'core',
);

/** The vended file that holds the identity provider. */
const identityProviderFile = (iac: Iac, idp: IdpOptions): string =>
  iac === 'cdk'
    ? joinPathFragments(
        CDK_CORE_DIR,
        'identity-providers',
        `${idp.nameKebabCase}.ts`,
      )
    : joinPathFragments(
        TERRAFORM_CORE_DIR,
        'user-identity',
        'identity',
        `${idp.nameKebabCase}-identity-provider.tf`,
      );

/**
 * The string values the identity provider file holds for these options. A
 * file that lacks one of them was generated with other options or edited.
 */
const renderedValues = (iac: Iac, idp: IdpOptions): string[] => [
  idp.issuerUrl,
  idp.clientId,
  idp.clientSecretName,
  ...(iac === 'cdk' ? idp.scopes : [idp.scopes.join(' ')]),
  ...[
    ...idp.cdkAttributeMapping.standard,
    ...idp.cdkAttributeMapping.custom,
  ].map(([, claim]) => claim),
  ...idp.identifiers,
];

/**
 * The generator keeps an existing identity provider file, so a re-run never
 * overwrites the user's edits. Refuse a name that maps to the file of another
 * identity provider, and say when the given options were not applied.
 */
const checkExistingIdentityProvider = (
  tree: Tree,
  iac: Iac,
  idp: IdpOptions,
): void => {
  const filePath = identityProviderFile(iac, idp);
  if (!tree.exists(filePath)) {
    return;
  }
  const content = tree.read(filePath, 'utf-8');
  const existingName = content.match(
    iac === 'cdk'
      ? /^\s*name:\s*['"]([^'"]+)['"]/m
      : /^\s*provider_name\s*=\s*"([^"]+)"/m,
  )?.[1];
  if (existingName !== undefined && existingName !== idp.name) {
    throw new Error(
      `${idp.nameKebabCase} is already used by ${existingName} (${filePath}), choose another name`,
    );
  }
  const applied = renderedValues(iac, idp).every(
    (value) => content.includes(`'${value}'`) || content.includes(`"${value}"`),
  );
  if (!applied) {
    logger.warn(
      `${filePath} already exists, so it was kept and the new options were not applied. Edit the file to change the ${idp.name} identity provider.`,
    );
  }
};

const addCdkIdentityProvider = async (tree: Tree, idp: IdpOptions) => {
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'core'),
    CDK_CORE_DIR,
    idp,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  await addStarExport(
    tree,
    joinPathFragments(CDK_CORE_DIR, 'index.ts'),
    `./identity-providers/${idp.nameKebabCase}.js`,
  );

  if (!(await addIdentityProviderToCdkUserIdentity(tree, idp))) {
    const importPath = `./identity-providers/${idp.nameKebabCase}${isEsmWorkspace(tree) ? '.js' : ''}`;
    logger.warn(
      `Could not add the ${idp.name} identity provider to ${USER_IDENTITY_CDK_FILE}, because the file no longer matches the generated shape. Add it to the UserIdentity constructor by hand, after the web client is created:

  new ${idp.className}IdentityProvider(this, '${idp.constructId}', {
    userPool: this.userPool,
    userPoolClient: this.userPoolClient,
    userPoolDomain: this.userPoolDomain,
  });

and import it:

  import { ${idp.className}IdentityProvider } from '${importPath}';`,
    );
  }
};

const addTerraformIdentityProvider = async (tree: Tree, idp: IdpOptions) => {
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'terraform', 'core'),
    TERRAFORM_CORE_DIR,
    idp,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  if (!(await addIdentityProviderToTerraformClient(tree, idp))) {
    logger.warn(
      `Could not add the ${idp.name} identity provider to ${USER_IDENTITY_TERRAFORM_FILE}, because the supported_identity_providers list of the web client no longer matches the generated shape. Add the identity provider to the list by hand, for example:

  supported_identity_providers = ["COGNITO", aws_cognito_identity_provider.${idp.nameSnakeCase}.provider_name]`,
    );
  }
};

const nextSteps = (iac: Iac, idp: IdpOptions): string => {
  const redirectUri =
    iac === 'cdk'
      ? `the ${idp.className}IdpRedirectUri output of the stack that contains UserIdentity`
      : `the ${idp.nameSnakeCase}_idp_redirect_uri output of the user-identity module. To see it, add this output to your root module:

       output "${idp.nameSnakeCase}_idp_redirect_uri" { value = module.user_identity.${idp.nameSnakeCase}_idp_redirect_uri }`;
  return `To let users sign in through ${idp.name}:

  1. Register an application at ${idp.name} for the client ID ${idp.clientId}, if you have not already, and note its client secret.
  2. Store the client secret in AWS Secrets Manager:

       aws secretsmanager create-secret --name ${idp.clientSecretName} --secret-string <client secret>

  3. Deploy.
  4. Add the redirect URI to the application at ${idp.name}. It is ${redirectUri}

See ${GUIDE_URL}`;
};

export const tsWebsiteAuthIdpGenerator = async (
  tree: Tree,
  schema: TsWebsiteAuthIdpGeneratorSchema,
): Promise<GeneratorCallback> => {
  const idp = resolveIdpOptions(schema);
  const iac = await resolveIac(tree, schema.iac ?? 'inherit');

  const userIdentityFile =
    iac === 'cdk' ? USER_IDENTITY_CDK_FILE : USER_IDENTITY_TERRAFORM_FILE;
  if (!tree.exists(userIdentityFile)) {
    throw new Error(
      `No user identity found at ${userIdentityFile}. Run the ts#website#auth generator first.`,
    );
  }
  checkExistingIdentityProvider(tree, iac, idp);

  if (iac === 'cdk') {
    await addCdkIdentityProvider(tree, idp);
  } else {
    await addTerraformIdentityProvider(tree, idp);
  }

  await addGeneratorMetricsIfApplicable(tree, [
    TS_WEBSITE_AUTH_IDP_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);

  // Printed from the callback so it appears after Nx lists the changed files,
  // on every run.
  return () => {
    logger.info(nextSteps(iac, idp));
  };
};

export default tsWebsiteAuthIdpGenerator;
