/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { logger, type Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../../utils/test.js';
import { tsReactWebsiteAuthGenerator } from '../../../react-website/cognito-auth/generator.js';
import { tsWebsiteAuthIdpGenerator } from './generator.js';
import type { TsWebsiteAuthIdpGeneratorSchema } from './schema';

const USER_IDENTITY = 'packages/common/terraform/src/core/user-identity';
const IDENTITY_TF = `${USER_IDENTITY}/identity/identity.tf`;
const IDP_TF = `${USER_IDENTITY}/identity/test-idp-identity-provider.tf`;
const OUTPUT_TF = `${USER_IDENTITY}/test-idp-identity-provider.tf`;
const PROVIDERS_LINE = 'supported_identity_providers = ["COGNITO"]';

const options: TsWebsiteAuthIdpGeneratorSchema = {
  type: 'oidc',
  name: 'TestIdp',
  issuerUrl: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_EXAMPLE',
  clientId: 'example',
  scopes: 'openid email profile',
  attributeMapping:
    '{"email":"email","given_name":"given_name","family_name":"family_name"}',
  iac: 'terraform',
};

const createWorkspaceWithAuth = async (): Promise<Tree> => {
  const tree = createTreeUsingTsSolutionSetup();
  tree.write(
    'packages/test-project/project.json',
    JSON.stringify({
      name: 'test-project',
      sourceRoot: 'packages/test-project/src',
      metadata: { ux: 'Cloudscape' },
    }),
  );
  tree.write(
    'packages/test-project/package.json',
    JSON.stringify({
      name: '@proj/test-project',
      version: '0.0.0',
      private: true,
      type: 'module',
    }),
  );
  tree.write(
    'packages/test-project/src/main.tsx',
    `import { RuntimeConfigProvider } from './components/RuntimeConfig';
export function Main() {
  return (
    <RuntimeConfigProvider>
      <App />
    </RuntimeConfigProvider>
  );
}
`,
  );
  await tsReactWebsiteAuthGenerator(tree, {
    project: 'test-project',
    cognitoDomain: 'test',
    allowSignup: true,
    iac: 'terraform',
  });
  return tree;
};

const contents = (tree: Tree): Record<string, string> =>
  Object.fromEntries(
    tree
      .listChanges()
      .filter((c) => c.type !== 'DELETE')
      .map((c) => [c.path, c.content?.toString('utf-8') ?? '']),
  );

describe('ts#website#auth#idp generator (terraform)', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = await createWorkspaceWithAuth();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fail when the workspace has no user identity', async () => {
    await expect(
      tsWebsiteAuthIdpGenerator(createTreeUsingTsSolutionSetup(), options),
    ).rejects.toThrow(
      `No user identity found at ${IDENTITY_TF}. Run the ts#website#auth generator first.`,
    );
  });

  it('should generate the identity provider and wire it into the client', async () => {
    await tsWebsiteAuthIdpGenerator(tree, options);

    expect(tree.read(IDP_TF, 'utf-8')).toMatchSnapshot(
      'identity/test-idp-identity-provider.tf',
    );
    expect(tree.read(OUTPUT_TF, 'utf-8')).toMatchSnapshot(
      'user-identity/test-idp-identity-provider.tf',
    );
    expect(tree.read(IDENTITY_TF, 'utf-8')).toMatchSnapshot('identity.tf');
  });

  it('should add the identity provider to the client and change nothing else in identity.tf', async () => {
    const before = tree.read(IDENTITY_TF, 'utf-8');

    await tsWebsiteAuthIdpGenerator(tree, options);

    const after = tree.read(IDENTITY_TF, 'utf-8');
    const added =
      'supported_identity_providers = ["COGNITO", aws_cognito_identity_provider.test_idp.provider_name]';
    expect(after).toContain(added);
    expect(after.replace(added, PROVIDERS_LINE)).toBe(before);
  });

  it('should append a second identity provider after the first', async () => {
    await tsWebsiteAuthIdpGenerator(tree, options);
    await tsWebsiteAuthIdpGenerator(tree, {
      ...options,
      name: 'OtherIdp',
      clientId: 'other',
    });

    expect(tree.read(IDENTITY_TF, 'utf-8')).toContain(
      'supported_identity_providers = ["COGNITO", aws_cognito_identity_provider.test_idp.provider_name, aws_cognito_identity_provider.other_idp.provider_name]',
    );
    expect(
      tree.exists(`${USER_IDENTITY}/identity/other-idp-identity-provider.tf`),
    ).toBe(true);
    expect(tree.exists(`${USER_IDENTITY}/other-idp-identity-provider.tf`)).toBe(
      true,
    );
  });

  it('should change no file when run again with the same name', async () => {
    await tsWebsiteAuthIdpGenerator(tree, options);
    const before = contents(tree);
    const warn = vi.spyOn(logger, 'warn');

    await tsWebsiteAuthIdpGenerator(tree, options);

    expect(contents(tree)).toEqual(before);
    expect(warn).not.toHaveBeenCalled();
  });

  it('should leave a diverged identity.tf unchanged and print the line to add', async () => {
    const diverged = tree
      .read(IDENTITY_TF, 'utf-8')
      .replace(PROVIDERS_LINE, 'supported_identity_providers = var.idps');
    tree.write(IDENTITY_TF, diverged);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await tsWebsiteAuthIdpGenerator(tree, options);

    expect(tree.read(IDENTITY_TF, 'utf-8')).toBe(diverged);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0];
    expect(message).toContain(IDENTITY_TF);
    expect(message).toContain(
      'supported_identity_providers = ["COGNITO", aws_cognito_identity_provider.test_idp.provider_name]',
    );
    expect(tree.exists(IDP_TF)).toBe(true);
  });

  it('should read the client secret from Secrets Manager', async () => {
    await tsWebsiteAuthIdpGenerator(tree, options);

    const idp = tree.read(IDP_TF, 'utf-8');
    expect(idp).toContain(
      'data "aws_secretsmanager_secret_version" "test_idp_client_secret" {',
    );
    expect(idp).toContain('secret_id = "TestIdp-oidc-client-secret"');
    expect(idp).toMatch(
      /client_secret\s+= data\.aws_secretsmanager_secret_version\.test_idp_client_secret\.secret_string/,
    );
  });

  it('should render identifiers only when given', async () => {
    await tsWebsiteAuthIdpGenerator(tree, options);
    expect(tree.read(IDP_TF, 'utf-8')).not.toContain('idp_identifiers');

    const withIdentifiers = await createWorkspaceWithAuth();
    await tsWebsiteAuthIdpGenerator(withIdentifiers, {
      ...options,
      identifiers: 'example.com, corp.example.com',
    });
    expect(withIdentifiers.read(IDP_TF, 'utf-8')).toContain(
      'idp_identifiers = ["example.com", "corp.example.com"]',
    );
  });

  it('should align the attribute mapping as terraform fmt does', async () => {
    await tsWebsiteAuthIdpGenerator(tree, {
      ...options,
      attributeMapping: JSON.stringify({
        email: 'mail',
        given_name: 'given_name',
        family_name: 'family_name',
        'custom:department': 'department',
      }),
    });

    const idp = tree.read(IDP_TF, 'utf-8');
    const block =
      idp.match(/attribute_mapping = \{\n([\s\S]*?)\n {2}\}/)?.[1] ?? '';
    const lines = block.split('\n');
    expect(lines).toHaveLength(5);
    expect(new Set(lines.map((l) => l.indexOf('=')))).toHaveProperty('size', 1);
    expect(lines).toContain('    "custom:department" = "department"');
    expect(lines.at(-1)).toBe('    "username"          = "sub"');
  });

  // Cognito returns these two values when Terraform reads the provider, so the
  // file sets them to keep a second `terraform plan` free of changes.
  it('should set the values Cognito adds when it returns the identity provider', async () => {
    await tsWebsiteAuthIdpGenerator(tree, options);

    const idp = tree.read(IDP_TF, 'utf-8');
    const block = (name: string): string[] =>
      (
        idp.match(new RegExp(`${name} = \\{\\n([\\s\\S]*?)\\n {2}\\}`))?.[1] ??
        ''
      ).split('\n');

    const providerDetails = block('provider_details');
    expect(providerDetails).toContain(
      '    attributes_url_add_attributes = "false"',
    );
    expect(new Set(providerDetails.map((l) => l.indexOf('=')))).toHaveProperty(
      'size',
      1,
    );

    expect(block('attribute_mapping')).toEqual([
      '    "email"       = "email"',
      '    "given_name"  = "given_name"',
      '    "family_name" = "family_name"',
      '    "username"    = "sub"',
    ]);
  });

  it('should refuse a mapping that sets username', async () => {
    await expect(
      tsWebsiteAuthIdpGenerator(tree, {
        ...options,
        attributeMapping:
          '{"email":"email","given_name":"given_name","family_name":"family_name","username":"sub"}',
      }),
    ).rejects.toThrow(/unknown user pool attribute username/);
  });

  it('should print the redirect URI output to add to the root module', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});

    const callback = await tsWebsiteAuthIdpGenerator(tree, options);
    callback();

    const message = info.mock.calls.map((c) => c[0]).join('\n');
    expect(message).toContain(
      'aws secretsmanager create-secret --name TestIdp-oidc-client-secret',
    );
    expect(message).toContain(
      'output "test_idp_idp_redirect_uri" { value = module.user_identity.test_idp_idp_redirect_uri }',
    );
  });
});
