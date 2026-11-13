/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createRequire } from 'node:module';
import { type Tree, updateJson } from '@nx/devkit';
import { ts } from '@ts-morph/bootstrap';
import { createTreeUsingTsSolutionSetup } from '../../../../utils/test.js';
import { tsReactWebsiteAuthGenerator } from '../../../react-website/cognito-auth/generator.js';
import { tsWebsiteAuthIdpGenerator } from './generator.js';

const IDP_DIR = 'packages/common/constructs/src/core/identity-providers';
const SECRET_REFERENCE =
  /^\{\{resolve:secretsmanager:TestIdp-oidc-client-secret:SecretString:::\}\}$/;

const realRequire = createRequire(import.meta.url);
const cdk = realRequire('aws-cdk-lib');
const cognito = realRequire('aws-cdk-lib/aws-cognito');
const { Template } = realRequire('aws-cdk-lib/assertions');

/** Transpile a generated construct to CommonJS and evaluate it. */
const evaluate = (source: string): Record<string, any> => {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} as Record<string, any> };
  new Function('require', 'module', 'exports', outputText)(
    realRequire,
    module,
    module.exports,
  );
  return module.exports;
};

/** Generate identity providers in a CommonJS workspace with auth. */
const generate = async (names: string[]): Promise<Tree> => {
  const tree = createTreeUsingTsSolutionSetup();
  updateJson(tree, 'package.json', (json) => ({ ...json, type: 'commonjs' }));
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
  await tsReactWebsiteAuthGenerator(tree, {
    project: 'test-project',
    cognitoDomain: 'test',
    allowSignup: true,
    iac: 'cdk',
  });
  for (const name of names) {
    await tsWebsiteAuthIdpGenerator(tree, {
      type: 'oidc',
      name,
      issuerUrl:
        'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_EXAMPLE',
      clientId: 'example',
      scopes: 'openid email profile',
      attributeMapping:
        '{"email":"email","given_name":"given_name","family_name":"family_name"}',
      iac: 'cdk',
    });
  }
  return tree;
};

/** Synthesize a user pool and web client with the given identity providers added, as UserIdentity does. */
const synth = (tree: Tree, files: Record<string, string>) => {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'Stack', {
    env: { account: '123456789012', region: 'us-east-1' },
  });
  const userPool = new cognito.UserPool(stack, 'UserPool');
  const userPoolDomain = new cognito.UserPoolDomain(stack, 'Domain', {
    userPool,
    cognitoDomain: { domainPrefix: 'test-123456789012' },
  });
  const userPoolClient = userPool.addClient('WebClient', {
    oAuth: {
      flows: { authorizationCodeGrant: true },
      callbackUrls: ['https://example.com'],
    },
  });
  for (const [file, className] of Object.entries(files)) {
    const exports = evaluate(tree.read(`${IDP_DIR}/${file}`, 'utf-8'));
    new exports[className](stack, className, {
      userPool,
      userPoolClient,
      userPoolDomain,
    });
  }
  return Template.fromStack(stack);
};

const resourcesOfType = (template: any, type: string) =>
  Object.entries(template.findResources(type)) as [string, any][];

describe('identity provider construct', () => {
  let one: Tree;
  let two: Tree;

  beforeAll(async () => {
    one = await generate(['TestIdp']);
    two = await generate(['TestIdp', 'OtherIdp']);
  });

  it('should declare an OIDC identity provider that reads its secret from Secrets Manager', () => {
    const template = synth(one, { 'test-idp.ts': 'TestIdpIdentityProvider' });

    const idps = resourcesOfType(
      template,
      'AWS::Cognito::UserPoolIdentityProvider',
    );
    expect(idps).toHaveLength(1);
    const [, idp] = idps[0];
    expect(idp.Properties.ProviderName).toBe('TestIdp');
    expect(idp.Properties.ProviderType).toBe('OIDC');
    expect(idp.Properties.ProviderDetails).toEqual({
      client_id: 'example',
      client_secret: expect.stringMatching(SECRET_REFERENCE),
      authorize_scopes: 'openid email profile',
      attributes_request_method: 'GET',
      oidc_issuer:
        'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_EXAMPLE',
    });
    expect(idp.Properties.AttributeMapping).toEqual({
      email: 'email',
      given_name: 'given_name',
      family_name: 'family_name',
    });
  });

  it('should add the identity provider to the client after COGNITO and make the client depend on it', () => {
    const template = synth(one, { 'test-idp.ts': 'TestIdpIdentityProvider' });

    const [[idpId]] = resourcesOfType(
      template,
      'AWS::Cognito::UserPoolIdentityProvider',
    );
    const [[, client]] = resourcesOfType(
      template,
      'AWS::Cognito::UserPoolClient',
    );
    expect(client.Properties.SupportedIdentityProviders).toEqual([
      'COGNITO',
      { Ref: idpId },
    ]);
    expect(client.DependsOn).toContain(idpId);
  });

  it('should output the redirect URI to register at the identity provider', () => {
    const template = synth(one, { 'test-idp.ts': 'TestIdpIdentityProvider' });

    const output = template.toJSON().Outputs.TestIdpIdpRedirectUri;
    expect(output).toBeDefined();
    const parts = output.Value['Fn::Join'][1];
    expect(parts[parts.length - 1]).toMatch(/\/oauth2\/idpresponse$/);
  });

  it('should list two identity providers on one client in the order they were added', () => {
    const template = synth(two, {
      'test-idp.ts': 'TestIdpIdentityProvider',
      'other-idp.ts': 'OtherIdpIdentityProvider',
    });

    const ids = Object.fromEntries(
      resourcesOfType(template, 'AWS::Cognito::UserPoolIdentityProvider').map(
        ([id, r]) => [r.Properties.ProviderName, id],
      ),
    );
    const [[, client]] = resourcesOfType(
      template,
      'AWS::Cognito::UserPoolClient',
    );
    expect(client.Properties.SupportedIdentityProviders).toEqual([
      'COGNITO',
      { Ref: ids.TestIdp },
      { Ref: ids.OtherIdp },
    ]);
  });

  it('should put no client secret value in the template', () => {
    const template = JSON.stringify(
      synth(one, { 'test-idp.ts': 'TestIdpIdentityProvider' }).toJSON(),
    );

    const secrets = [...template.matchAll(/"client_secret":("[^"]*")/g)].map(
      (m) => JSON.parse(m[1]),
    );
    expect(secrets).toHaveLength(1);
    expect(secrets[0]).toMatch(SECRET_REFERENCE);
  });
});
