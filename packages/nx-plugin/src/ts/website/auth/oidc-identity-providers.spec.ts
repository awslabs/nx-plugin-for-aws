/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import type { Tree } from '@nx/devkit';
import { ts } from '@ts-morph/bootstrap';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { tsWebsiteAuthGenerator } from './generator.js';

const CORE_DIR = 'packages/common/constructs/src/core';
const OKTA_SECRET_REFERENCE =
  '{{resolve:secretsmanager:okta-oidc-client-secret:SecretString:::}}';

const realRequire = createRequire(import.meta.url);
const cdk = realRequire('aws-cdk-lib');
const { Template } = realRequire('aws-cdk-lib/assertions');

/**
 * Load a generated TypeScript module from the tree: transpile it to CommonJS
 * and evaluate it, loading its relative imports from the tree too.
 */
const loadFromTree = (
  tree: Tree,
  filePath: string,
  cache = new Map<string, Record<string, any>>(),
): Record<string, any> => {
  const cached = cache.get(filePath);
  if (cached) {
    return cached;
  }
  const { outputText } = ts.transpileModule(tree.read(filePath, 'utf-8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} as Record<string, any> };
  cache.set(filePath, module.exports);
  const require = (specifier: string) =>
    specifier.startsWith('.')
      ? loadFromTree(
          tree,
          posix.join(
            posix.dirname(filePath),
            `${specifier.replace(/\.js$/, '')}.ts`,
          ),
          cache,
        )
      : realRequire(specifier);
  new Function('require', 'module', 'exports', outputText)(
    require,
    module,
    module.exports,
  );
  return module.exports;
};

const OKTA = {
  name: 'Okta',
  issuerUrl: 'https://example.okta.com',
  clientId: '0oa1example',
  clientSecretName: 'okta-oidc-client-secret',
};

const resourcesOfType = (template: any, type: string) =>
  Object.entries(template.findResources(type)) as [string, any][];

describe('OidcIdentityProviders construct', () => {
  let UserIdentity: any;
  let outdir: string;

  beforeAll(async () => {
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
      JSON.stringify({ name: '@proj/test-project', version: '0.0.0' }),
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
    await tsWebsiteAuthGenerator(tree, {
      project: 'test-project',
      cognitoDomain: 'test',
      allowSignup: true,
      iac: 'cdk',
      federation: 'oidc',
    });
    ({ UserIdentity } = loadFromTree(tree, `${CORE_DIR}/user-identity.ts`));
    outdir = mkdtempSync(join(tmpdir(), 'cdk.out-oidc-'));
  });

  afterAll(() => {
    rmSync(outdir, { recursive: true, force: true });
  });

  const newStack = () =>
    new cdk.Stack(new cdk.App({ outdir }), 'Stack', {
      env: { account: '123456789012', region: 'us-east-1' },
    });

  /** Synthesise a UserIdentity with the given identity providers. */
  const synth = (oidcIdentityProviders?: object[]) => {
    const stack = newStack();
    new UserIdentity(stack, 'UserIdentity', { oidcIdentityProviders });
    return Template.fromStack(stack);
  };

  const create = (oidcIdentityProviders: object[]) => () =>
    new UserIdentity(newStack(), 'UserIdentity', { oidcIdentityProviders });

  const webClient = (template: any) => {
    const clients = resourcesOfType(template, 'AWS::Cognito::UserPoolClient');
    expect(clients).toHaveLength(1);
    return clients[0][1];
  };

  const redirectUriOutput = (template: any) =>
    Object.entries(template.toJSON().Outputs ?? {}).find(([key]) =>
      key.startsWith('UserIdentityOidcIdentityProvidersIdpRedirectUri'),
    )?.[1] as any;

  describe('with identity providers', () => {
    let template: any;

    beforeAll(() => {
      template = synth([OKTA]);
    });

    it('should declare an OIDC identity provider that reads its secret from Secrets Manager', () => {
      const idps = resourcesOfType(
        template,
        'AWS::Cognito::UserPoolIdentityProvider',
      );
      expect(idps).toHaveLength(1);
      const [, idp] = idps[0];
      expect(idp.Properties.ProviderName).toBe('Okta');
      expect(idp.Properties.ProviderType).toBe('OIDC');
      expect(idp.Properties.ProviderDetails).toEqual({
        client_id: '0oa1example',
        client_secret: OKTA_SECRET_REFERENCE,
        authorize_scopes: 'openid email profile',
        attributes_request_method: 'GET',
        oidc_issuer: 'https://example.okta.com',
      });
      expect(idp.Properties.AttributeMapping).toEqual({
        email: 'email',
        given_name: 'given_name',
        family_name: 'family_name',
      });
      expect(idp.Properties.IdpIdentifiers).toBeUndefined();
    });

    it('should list the identity provider and COGNITO on the web client', () => {
      const [[idpId]] = resourcesOfType(
        template,
        'AWS::Cognito::UserPoolIdentityProvider',
      );
      expect(webClient(template).Properties.SupportedIdentityProviders).toEqual(
        [{ Ref: idpId }, 'COGNITO'],
      );
    });

    it('should output the redirect URI to register at the identity provider', () => {
      const output = redirectUriOutput(template);
      expect(output).toBeDefined();
      const parts = output.Value['Fn::Join'][1];
      expect(parts[parts.length - 1]).toMatch(/\/oauth2\/idpresponse$/);
    });

    it('should put no client secret value in the template', () => {
      const secrets = [
        ...JSON.stringify(template.toJSON()).matchAll(
          /"client_secret":("[^"]*")/g,
        ),
      ].map((m) => JSON.parse(m[1]));
      expect(secrets).toEqual([OKTA_SECRET_REFERENCE]);
    });
  });

  it('should keep only COGNITO on the web client and still output the redirect URI without identity providers', () => {
    for (const template of [synth([]), synth(undefined)]) {
      expect(
        resourcesOfType(template, 'AWS::Cognito::UserPoolIdentityProvider'),
      ).toEqual([]);
      expect(webClient(template).Properties.SupportedIdentityProviders).toEqual(
        ['COGNITO'],
      );
      expect(redirectUriOutput(template)).toBeDefined();
    }
  });

  it('should list several identity providers on the web client', () => {
    const template = synth([
      OKTA,
      {
        name: 'Entra',
        issuerUrl:
          'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0',
        clientId: '11111111-2222-3333-4444-555555555555',
        clientSecretName: 'entra-oidc-client-secret',
        identifiers: ['example.com'],
      },
    ]);

    const ids = Object.fromEntries(
      resourcesOfType(template, 'AWS::Cognito::UserPoolIdentityProvider').map(
        ([id, r]) => [r.Properties.ProviderName, id],
      ),
    );
    expect(Object.keys(ids).sort()).toEqual(['Entra', 'Okta']);
    expect(webClient(template).Properties.SupportedIdentityProviders).toEqual(
      expect.arrayContaining([
        { Ref: ids.Okta },
        { Ref: ids.Entra },
        'COGNITO',
      ]),
    );
    expect(
      webClient(template).Properties.SupportedIdentityProviders,
    ).toHaveLength(3);
  });

  it('should pass scopes, identifiers and standard and other attributes through', () => {
    const template = synth([
      {
        ...OKTA,
        scopes: ['openid', 'email', 'profile', 'groups'],
        identifiers: ['example.com', 'example.org'],
        attributeMapping: {
          email: 'email',
          given_name: 'first',
          family_name: 'last',
          name: 'name',
          email_verified: 'email_verified',
          phone_number_verified: 'phone_verified',
          'custom:team': 'team',
        },
      },
    ]);

    const [[, idp]] = resourcesOfType(
      template,
      'AWS::Cognito::UserPoolIdentityProvider',
    );
    expect(idp.Properties.ProviderDetails.authorize_scopes).toBe(
      'openid email profile groups',
    );
    expect(idp.Properties.IdpIdentifiers).toEqual([
      'example.com',
      'example.org',
    ]);
    expect(idp.Properties.AttributeMapping).toEqual({
      email: 'email',
      given_name: 'first',
      family_name: 'last',
      name: 'name',
      email_verified: 'email_verified',
      phone_number_verified: 'phone_verified',
      'custom:team': 'team',
    });
  });

  it('should accept the issuers of tenants and of Auth0 with a trailing slash', () => {
    expect(
      create([
        {
          ...OKTA,
          issuerUrl:
            'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0',
        },
      ]),
    ).not.toThrow();
    expect(
      create([{ ...OKTA, issuerUrl: 'https://example.us.auth0.com/' }]),
    ).not.toThrow();
  });

  describe('validation', () => {
    const error = (index: number, name: string, rule: string) =>
      `UserIdentity: oidcIdentityProviders[${index}] (${name}): ${rule}`;

    it.each([
      ['ab', 'name must be 3-32 letters'],
      ['1abc', 'name must be 3-32 letters'],
      ['has_underscore', 'name must be 3-32 letters'],
      ['a'.repeat(33), 'name must be 3-32 letters'],
      ['COGNITO', 'name must not be COGNITO'],
      ['cognito', 'name must not be COGNITO'],
    ])('should refuse the name %s', (name, rule) => {
      expect(create([{ ...OKTA, name }])).toThrow(error(0, name, rule));
    });

    it('should refuse names that differ only in case', () => {
      expect(create([OKTA, { ...OKTA, name: 'okta' }])).toThrow(
        error(1, 'okta', 'names must be unique ignoring case'),
      );
    });

    it.each([
      ['example.okta.com', 'issuerUrl must be a URL'],
      ['http://example.okta.com', 'issuerUrl must use https://'],
      ['https://example.okta.com?x=1', 'issuerUrl must not have a query'],
      ['https://example.okta.com#x', 'issuerUrl must not have a query'],
      ['https://user:pass@example.okta.com', 'issuerUrl must not have a query'],
      ['https://example.okta.com/a b', 'issuerUrl must not contain whitespace'],
      [
        'https://login.microsoftonline.com/common/v2.0',
        'Microsoft Entra ID multi-tenant issuers',
      ],
      [
        'https://login.microsoftonline.com/organizations/v2.0',
        'Microsoft Entra ID multi-tenant issuers',
      ],
      [
        'https://login.microsoftonline.com/consumers/v2.0',
        'Microsoft Entra ID multi-tenant issuers',
      ],
      [
        'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0',
        'Microsoft Entra ID multi-tenant issuers',
      ],
      [
        'https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0/',
        'Microsoft Entra ID issuers have no trailing slash. Use https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0',
      ],
      [
        'https://example.us.auth0.com',
        'Auth0 issuers end with a slash. Use https://example.us.auth0.com/',
      ],
    ])('should refuse the issuer %s', (issuerUrl, rule) => {
      expect(create([{ ...OKTA, issuerUrl }])).toThrow(error(0, 'Okta', rule));
    });

    it.each([[''], ['  ']])('should refuse the client ID "%s"', (clientId) => {
      expect(create([{ ...OKTA, clientId }])).toThrow(
        error(0, 'Okta', 'clientId must not be empty'),
      );
    });

    it.each([
      [''],
      ['arn:aws:secretsmanager:us-east-1:123456789012:secret:okta'],
      ['has space'],
      ['a'.repeat(513)],
    ])('should refuse the secret name "%s"', (clientSecretName) => {
      expect(create([{ ...OKTA, clientSecretName }])).toThrow(
        error(0, 'Okta', 'clientSecretName must be the name of a secret'),
      );
    });

    it.each([
      [['email', 'profile'], 'scopes must include openid'],
      [['openid', 'email profile'], 'scopes must be non-empty'],
      [['openid', ''], 'scopes must be non-empty'],
    ])('should refuse the scopes %j', (scopes, rule) => {
      expect(create([{ ...OKTA, scopes }])).toThrow(error(0, 'Okta', rule));
    });

    const mapping = {
      email: 'email',
      given_name: 'given_name',
      family_name: 'family_name',
    };

    it.each([
      [
        { ...mapping, username: 'sub' },
        'attributeMapping has an unknown user pool attribute username',
      ],
      [
        { ...mapping, team: 'team' },
        'attributeMapping has an unknown user pool attribute team',
      ],
      [
        { ...mapping, [`custom:${'a'.repeat(21)}`]: 'team' },
        'attributeMapping has an unknown user pool attribute custom:',
      ],
      [
        { ...mapping, given_name: '' },
        'attributeMapping must map given_name to a claim name of 1-128 characters',
      ],
      [
        { ...mapping, given_name: 'a'.repeat(129) },
        'attributeMapping must map given_name to a claim name of 1-128 characters',
      ],
      [{ email: 'email' }, 'attributeMapping must map given_name'],
      [
        { email: 'email', given_name: 'given_name' },
        'attributeMapping must map family_name',
      ],
    ])('should refuse the attribute mapping %j', (attributeMapping, rule) => {
      expect(create([{ ...OKTA, attributeMapping }])).toThrow(
        error(0, 'Okta', rule),
      );
    });

    it.each([
      [
        Array.from({ length: 51 }, (_, i) => `d${i}.example.com`),
        'identifiers must have at most 50 entries',
      ],
      [['a'.repeat(41)], 'each identifier must be 1-40'],
      [[''], 'each identifier must be 1-40'],
      [['example#com'], 'each identifier must be 1-40'],
    ])('should refuse identifiers %#', (identifiers, rule) => {
      expect(create([{ ...OKTA, identifiers }])).toThrow(
        error(0, 'Okta', rule),
      );
    });

    it('should accept 50 identifiers of 40 characters', () => {
      expect(
        create([
          {
            ...OKTA,
            identifiers: Array.from({ length: 50 }, () => 'a'.repeat(40)),
          },
        ]),
      ).not.toThrow();
    });

    it('should skip the checks of values that are tokens', () => {
      const token = (value: string) =>
        cdk.Lazy.string({ produce: () => value });
      expect(
        create([
          {
            name: 'Okta',
            issuerUrl: token('http://not-checked'),
            clientId: token(''),
            clientSecretName: token('not a name'),
            scopes: ['openid', token('not checked')],
            attributeMapping: { ...mapping, given_name: token('') },
            identifiers: [token('not#checked')],
          },
        ]),
      ).not.toThrow();
    });

    it('should refuse a name that is a token', () => {
      expect(
        create([{ ...OKTA, name: cdk.Lazy.string({ produce: () => 'Okta' }) }]),
      ).toThrow(
        'UserIdentity: oidcIdentityProviders[0]: name must be a literal string, not a token',
      );
    });
  });
});
