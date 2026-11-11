/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger, type Tree, updateJson } from '@nx/devkit';
import { expectHasMetricTags } from '../../../../utils/metrics-assertions.js';
import { expectTypeScriptToParse } from '../../../../utils/test/ts.spec.js';
import { createTreeUsingTsSolutionSetup } from '../../../../utils/test.js';
import { tsReactWebsiteAuthGenerator } from '../../../react-website/cognito-auth/generator.js';
import {
  TS_WEBSITE_AUTH_IDP_GENERATOR_INFO,
  tsWebsiteAuthIdpGenerator,
} from './generator.js';
import type { TsWebsiteAuthIdpGeneratorSchema } from './schema';

const CORE = 'packages/common/constructs/src/core';
const USER_IDENTITY = `${CORE}/user-identity.ts`;
const INDEX = `${CORE}/index.ts`;
const IDP_FILE = `${CORE}/identity-providers/test-idp.ts`;
const ANCHOR =
  'this.userPoolClient = this.createUserPoolClient(this.userPool);';

const options: TsWebsiteAuthIdpGeneratorSchema = {
  type: 'oidc',
  name: 'TestIdp',
  issuerUrl: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_EXAMPLE',
  clientId: 'example',
  scopes: 'openid email profile',
  attributeMapping:
    '{"email":"email","given_name":"given_name","family_name":"family_name"}',
  iac: 'cdk',
};

/** A workspace with a website whose auth `ts#website#auth` has vended. */
const createWorkspaceWithAuth = async (
  iac: 'cdk' | 'terraform',
  { cjs = false }: { cjs?: boolean } = {},
): Promise<Tree> => {
  const tree = createTreeUsingTsSolutionSetup();
  if (cjs) {
    updateJson(tree, 'package.json', (json) => ({
      ...json,
      type: 'commonjs',
    }));
  }
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
      ...(cjs ? {} : { type: 'module' }),
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
    iac,
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

describe('ts#website#auth#idp generator (cdk)', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = await createWorkspaceWithAuth('cdk');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fail when the workspace has no user identity', async () => {
    await expect(
      tsWebsiteAuthIdpGenerator(createTreeUsingTsSolutionSetup(), options),
    ).rejects.toThrow(
      `No user identity found at ${USER_IDENTITY}. Run the ts#website#auth generator first.`,
    );
  });

  it.each<[string, Partial<TsWebsiteAuthIdpGeneratorSchema>, string | RegExp]>([
    ['a 2-character name', { name: 'ab' }, /name must be 3-32 characters/],
    [
      'a 33-character name',
      { name: `A${'b'.repeat(32)}` },
      /name must be 3-32 characters/,
    ],
    ['a name with _', { name: 'my_idp' }, /name must be 3-32 characters/],
    [
      'a name starting with a digit',
      { name: '1okta' },
      /name must be 3-32 characters/,
    ],
    ['the reserved name COGNITO', { name: 'cognito' }, /COGNITO/],
    [
      'an http issuer',
      { issuerUrl: 'http://idp.example.com' },
      'issuerUrl must use https://',
    ],
    ...['common', 'organizations', 'consumers'].map(
      (tenant) =>
        [
          `the Entra ID /${tenant}/ issuer`,
          { issuerUrl: `https://login.microsoftonline.com/${tenant}/v2.0` },
          "Microsoft Entra ID multi-tenant issuers (/common/, /organizations/, /consumers/) are not supported. Use your tenant's issuer, https://login.microsoftonline.com/<tenant-id>/v2.0",
        ] as [string, Partial<TsWebsiteAuthIdpGeneratorSchema>, string],
    ),
    [
      'scopes without openid',
      { scopes: 'email profile' },
      'scopes must include openid',
    ],
    [
      'a mapping that is not JSON',
      { attributeMapping: 'not json' },
      /attributeMapping must be a JSON object/,
    ],
    [
      'a mapping without given_name',
      { attributeMapping: '{"email":"email","family_name":"family_name"}' },
      'attributeMapping must map given_name',
    ],
    [
      'a mapping with an unknown attribute',
      {
        attributeMapping:
          '{"nope":"x","email":"email","given_name":"given_name","family_name":"family_name"}',
      },
      /unknown user pool attribute nope/,
    ],
    ['a client ID with a quote', { clientId: 'a"b' }, /clientId must/],
    [
      'an identifier longer than 40 characters',
      { identifiers: `example.com, ${'a'.repeat(41)}` },
      /identifiers must/,
    ],
    // Values that would end or interpolate a TypeScript or HCL string.
    [
      'an issuer with a double quote',
      { issuerUrl: 'https://idp.example.com/a"b' },
      /issuerUrl must not contain/,
    ],
    [
      'an issuer with ${',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the test needs a literal ${
      { issuerUrl: 'https://idp.example.com/${path.cwd}' },
      /issuerUrl must not contain/,
    ],
    [
      'an issuer with }',
      { issuerUrl: 'https://idp.example.com/a}' },
      /issuerUrl must not contain/,
    ],
    [
      'scopes with a double quote',
      { scopes: 'openid email"x' },
      /scopes must not contain/,
    ],
    [
      'a claim with ${',
      {
        attributeMapping:
          // biome-ignore lint/suspicious/noTemplateCurlyInString: the test needs a literal ${
          '{"email":"${x}","given_name":"given_name","family_name":"family_name"}',
      },
      /attributeMapping must map email to a claim name/,
    ],
    [
      'a client secret name with a double quote',
      { clientSecretName: 'a"b' },
      /clientSecretName must/,
    ],
    [
      'the type saml',
      { type: 'saml' as TsWebsiteAuthIdpGeneratorSchema['type'] },
      'type must be oidc, but is saml',
    ],
    // Issuers OpenID Connect Discovery does not allow.
    [
      'an issuer with a query',
      { issuerUrl: 'https://idp.example.com/a?b=1' },
      /issuerUrl must not have a query, fragment, user name or password/,
    ],
    [
      'an issuer with a fragment',
      { issuerUrl: 'https://idp.example.com/a#frag' },
      /issuerUrl must not have a query, fragment, user name or password/,
    ],
    [
      'an issuer with a user name',
      { issuerUrl: 'https://user@idp.example.com' },
      /issuerUrl must not have a query, fragment, user name or password/,
    ],
    [
      'an issuer with a password',
      { issuerUrl: 'https://:secret@idp.example.com' },
      /issuerUrl must not have a query, fragment, user name or password/,
    ],
    // Other shapes the option checks refuse.
    [
      'an issuer that is not a URL',
      { issuerUrl: 'not a url' },
      'issuerUrl must be a URL, but is not a url',
    ],
    [
      'a mapping that is a JSON array',
      { attributeMapping: '["email"]' },
      /attributeMapping must be a JSON object/,
    ],
    [
      'a claim that is not a string',
      {
        attributeMapping:
          '{"email":1,"given_name":"given_name","family_name":"family_name"}',
      },
      /attributeMapping must map email to a claim name/,
    ],
    [
      'a claim longer than 128 characters',
      {
        attributeMapping: JSON.stringify({
          email: 'e'.repeat(129),
          given_name: 'given_name',
          family_name: 'family_name',
        }),
      },
      /attributeMapping must map email to a claim name/,
    ],
    [
      'more than 50 identifiers',
      {
        identifiers: Array.from({ length: 51 }, (_, i) => `d${i}.com`).join(
          ',',
        ),
      },
      /identifiers must/,
    ],
    [
      'an identifier with a double quote',
      { identifiers: 'a"b' },
      /identifiers must/,
    ],
  ])('should refuse %s and change no file', async (_, override, message) => {
    const before = contents(tree);

    await expect(
      tsWebsiteAuthIdpGenerator(tree, { ...options, ...override }),
    ).rejects.toThrow(message);

    expect(contents(tree)).toEqual(before);
  });

  it('should generate the identity provider construct and wire it in', async () => {
    await tsWebsiteAuthIdpGenerator(tree, options);

    expect(tree.read(IDP_FILE, 'utf-8')).toMatchSnapshot('test-idp.ts');
    expect(tree.read(USER_IDENTITY, 'utf-8')).toMatchSnapshot(
      'user-identity.ts',
    );
    expect(tree.read(INDEX, 'utf-8')).toMatchSnapshot('index.ts');
  });

  it('should add the construct to UserIdentity right after the client is created', async () => {
    await tsWebsiteAuthIdpGenerator(tree, options);

    const userIdentity = tree.read(USER_IDENTITY, 'utf-8');
    const lines = userIdentity.split('\n').map((l) => l.trim());
    const anchor = lines.indexOf(ANCHOR);
    expect(lines[anchor + 1]).toBe(
      "new TestIdpIdentityProvider(this, 'TestIdpIdentityProvider', {",
    );
    expect(lines.slice(anchor + 2, anchor + 6)).toEqual([
      'userPool: this.userPool,',
      'userPoolClient: this.userPoolClient,',
      'userPoolDomain: this.userPoolDomain,',
      '});',
    ]);
    expect(lines[anchor + 6]).toMatch(/^this\.identityPool = /);
    expect(userIdentity).toContain(
      "import { TestIdpIdentityProvider } from './identity-providers/test-idp.js';",
    );
    expect(tree.read(INDEX, 'utf-8')).toContain(
      "export * from './identity-providers/test-idp.js';",
    );
    expectTypeScriptToParse(tree, [USER_IDENTITY, IDP_FILE]);
  });

  it('should use extensionless imports in a CommonJS workspace', async () => {
    const cjs = await createWorkspaceWithAuth('cdk', { cjs: true });

    await tsWebsiteAuthIdpGenerator(cjs, options);

    expect(cjs.read(USER_IDENTITY, 'utf-8')).toContain(
      "import { TestIdpIdentityProvider } from './identity-providers/test-idp';",
    );
    expect(cjs.read(INDEX, 'utf-8')).toContain(
      "export * from './identity-providers/test-idp';",
    );
    expect(cjs.read(INDEX, 'utf-8')).not.toContain('test-idp.js');
    expectTypeScriptToParse(cjs, [USER_IDENTITY, IDP_FILE]);
  });

  it('should append a second identity provider after the first', async () => {
    await tsWebsiteAuthIdpGenerator(tree, options);
    await tsWebsiteAuthIdpGenerator(tree, {
      ...options,
      name: 'OtherIdp',
      clientId: 'other',
    });

    const userIdentity = tree.read(USER_IDENTITY, 'utf-8');
    const first = userIdentity.indexOf('new TestIdpIdentityProvider(this');
    const second = userIdentity.indexOf('new OtherIdpIdentityProvider(this');
    expect(first).toBeGreaterThan(userIdentity.indexOf(ANCHOR));
    expect(second).toBeGreaterThan(first);
    expect(second).toBeLessThan(userIdentity.indexOf('this.identityPool ='));
    expect(userIdentity).toContain(
      "import { TestIdpIdentityProvider } from './identity-providers/test-idp.js';",
    );
    expect(userIdentity).toContain(
      "import { OtherIdpIdentityProvider } from './identity-providers/other-idp.js';",
    );
    const index = tree.read(INDEX, 'utf-8');
    expect(index).toContain(
      "export * from './identity-providers/test-idp.js';",
    );
    expect(index).toContain(
      "export * from './identity-providers/other-idp.js';",
    );
    expect(tree.exists(`${CORE}/identity-providers/other-idp.ts`)).toBe(true);
  });

  it('should change no file when run again with the same name', async () => {
    await tsWebsiteAuthIdpGenerator(tree, options);
    const before = contents(tree);
    const warn = vi.spyOn(logger, 'warn');

    await tsWebsiteAuthIdpGenerator(tree, options);

    expect(contents(tree)).toEqual(before);
    expect(warn).not.toHaveBeenCalled();
  });

  it('should refuse a name that uses the file of another identity provider', async () => {
    await tsWebsiteAuthIdpGenerator(tree, options);
    const before = contents(tree);

    await expect(
      tsWebsiteAuthIdpGenerator(tree, { ...options, name: 'Test-Idp' }),
    ).rejects.toThrow(
      `test-idp is already used by TestIdp (${IDP_FILE}), choose another name`,
    );
    expect(contents(tree)).toEqual(before);
  });

  it('should keep the existing file and warn when run again with other options', async () => {
    await tsWebsiteAuthIdpGenerator(tree, options);
    const before = contents(tree);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await tsWebsiteAuthIdpGenerator(tree, { ...options, clientId: 'other' });

    expect(contents(tree)).toEqual(before);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(
      `${IDP_FILE} already exists, so it was kept and the new options were not applied. Edit the file to change the TestIdp identity provider.`,
    );
  });

  it('should keep a rewritten identity provider file and warn', async () => {
    await tsWebsiteAuthIdpGenerator(tree, options);
    tree.write(IDP_FILE, '// my own identity provider\n');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await tsWebsiteAuthIdpGenerator(tree, options);

    expect(tree.read(IDP_FILE, 'utf-8')).toBe('// my own identity provider\n');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('the new options were not applied');
  });

  it('should leave a diverged user-identity.ts unchanged and print the lines to add', async () => {
    const diverged = tree
      .read(USER_IDENTITY, 'utf-8')
      .replace(ANCHOR, 'this.userPoolClient = this.createClient();');
    tree.write(USER_IDENTITY, diverged);
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    await tsWebsiteAuthIdpGenerator(tree, options);

    expect(tree.read(USER_IDENTITY, 'utf-8')).toBe(diverged);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0][0];
    expect(message).toContain(USER_IDENTITY);
    expect(message).toContain(
      "new TestIdpIdentityProvider(this, 'TestIdpIdentityProvider'",
    );
    expect(message).toContain(
      "import { TestIdpIdentityProvider } from './identity-providers/test-idp.js'",
    );
    expect(tree.exists(IDP_FILE)).toBe(true);
  });

  it('should reference the client secret by name only', async () => {
    await tsWebsiteAuthIdpGenerator(tree, options);

    expect(tree.read(IDP_FILE, 'utf-8')).toMatch(
      /SecretValue\.secretsManager\(\s*'TestIdp-oidc-client-secret',?\s*\)/,
    );
    const schema = JSON.parse(
      readFileSync(join(import.meta.dirname, 'schema.json'), 'utf-8'),
    );
    expect(Object.keys(schema.properties)).not.toContain('clientSecret');
  });

  it('should use the given client secret name verbatim', async () => {
    await tsWebsiteAuthIdpGenerator(tree, {
      ...options,
      clientSecretName: 'custom/name',
    });

    expect(tree.read(IDP_FILE, 'utf-8')).toMatch(
      /SecretValue\.secretsManager\(\s*'custom\/name',?\s*\)/,
    );
  });

  it('should render standard attributes by their CDK key and others under custom', async () => {
    await tsWebsiteAuthIdpGenerator(tree, {
      ...options,
      attributeMapping: JSON.stringify({
        email: 'mail',
        given_name: 'given_name',
        family_name: 'family_name',
        email_verified: 'email_verified',
        'custom:dept': 'department',
      }),
    });

    const idp = tree.read(IDP_FILE, 'utf-8');
    expect(idp).toContain("email: ProviderAttribute.other('mail'),");
    expect(idp).toContain("givenName: ProviderAttribute.other('given_name'),");
    expect(idp).toContain(
      "familyName: ProviderAttribute.other('family_name'),",
    );
    expect(idp).toContain(
      "emailVerified: ProviderAttribute.other('email_verified'),",
    );
    expect(idp).toMatch(
      /custom: \{\s*'custom:dept': ProviderAttribute\.other\('department'\),?\s*\}/,
    );
  });

  it('should pass identifiers to the identity provider', async () => {
    await tsWebsiteAuthIdpGenerator(tree, {
      ...options,
      identifiers: 'example.com, corp.example.com',
    });

    expect(tree.read(IDP_FILE, 'utf-8')).toMatch(
      /identifiers: \[\s*'example\.com',\s*'corp\.example\.com',?\s*\]/,
    );
  });

  it('should print the next steps after the generator runs', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => {});

    const callback = await tsWebsiteAuthIdpGenerator(tree, options);
    expect(info).not.toHaveBeenCalled();
    callback();

    const message = info.mock.calls.map((c) => c[0]).join('\n');
    expect(message).toContain(
      'aws secretsmanager create-secret --name TestIdp-oidc-client-secret',
    );
    expect(message).toContain('TestIdpIdpRedirectUri');
    expect(message.indexOf('create-secret')).toBeLessThan(
      message.indexOf('TestIdpIdpRedirectUri'),
    );
  });

  it('should record the metric', async () => {
    await tsWebsiteAuthIdpGenerator(tree, options);

    expect(TS_WEBSITE_AUTH_IDP_GENERATOR_INFO.id).toBe('ts#website#auth#idp');
    expect(TS_WEBSITE_AUTH_IDP_GENERATOR_INFO.metric).toBe('g78');
    expectHasMetricTags(tree, 'g78');
  });
});
