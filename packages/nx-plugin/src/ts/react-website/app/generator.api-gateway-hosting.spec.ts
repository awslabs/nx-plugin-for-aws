/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { App, Stack } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import {
  AuthorizationType,
  DomainName,
  EndpointType,
  type RestApi,
} from 'aws-cdk-lib/aws-apigateway';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { InterfaceVpcEndpoint } from 'aws-cdk-lib/aws-ec2';
import { type IGrantable, PolicyDocument } from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  API_CONSTRUCTS_DEPENDENCIES,
  addApiGatewayInfra,
} from '../../../utils/api-constructs/api-constructs.js';
import { declareDependencies } from '../../../utils/declared-dependencies.js';
import { addIdentityInfra } from '../../../utils/identity-constructs/identity-constructs.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../../utils/shared-constructs.js';
import {
  importSharedConstructs,
  typeCheck,
  writeSharedConstructs,
} from '../../../utils/test/cdk-constructs.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { tsReactWebsiteGenerator } from './generator.js';
import type { TsReactWebsiteGeneratorSchema } from './schema';

type Auth = 'iam' | 'cognito' | 'custom';

const CONSTRUCTS_SRC = 'packages/common/constructs/src';

const options: TsReactWebsiteGeneratorSchema = {
  name: 'website',
  directory: 'packages',
  iac: 'cdk',
  ux: 'cloudscape',
  hosting: 'api-gateway',
  apiProject: 'web-api',
};

/** A REST API project, as ts#smithy-api leaves it, with its CDK construct */
const addRestApi = async (tree: Tree, auth: Auth = 'iam') => {
  const declaration = declareDependencies()({
    ts: [...SHARED_CONSTRUCTS_DEPENDENCIES, ...API_CONSTRUCTS_DEPENDENCIES],
  });
  await sharedConstructsGenerator(tree, { iac: 'cdk' }, declaration);
  addProjectConfiguration(tree, '@proj/web-api', {
    root: 'packages/web-api/backend',
    metadata: { generator: 'ts#smithy-api', apiName: 'web-api', auth },
  } as Parameters<typeof addProjectConfiguration>[2]);
  await addApiGatewayInfra(
    tree,
    {
      iac: 'cdk',
      apiProjectName: '@proj/web-api',
      apiNameClassName: 'WebApi',
      apiNameKebabCase: 'web-api',
      constructType: 'rest',
      backend: {
        type: 'smithy',
        integrationPattern: 'isolated',
        bundleOutputDir: 'dist/packages/web-api/bundle',
        ...(auth === 'custom'
          ? { authorizerBundleOutputDir: 'dist/packages/web-api/authorizer' }
          : {}),
      },
      auth,
    },
    declaration,
  );
};

const read = (tree: Tree, path: string) => tree.read(path, 'utf-8') ?? '';

const listFiles = (tree: Tree, dir = ''): string[] =>
  tree.isFile(dir)
    ? [dir]
    : tree
        .children(dir)
        .filter((child) => dir !== '' || child !== 'node_modules')
        .flatMap((child) => listFiles(tree, dir ? `${dir}/${child}` : child));

const snapshotFiles = (tree: Tree) =>
  Object.fromEntries(listFiles(tree).map((path) => [path, read(tree, path)]));

describe('react-website generator, hosted through API Gateway', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = createTreeUsingTsSolutionSetup();
    await addRestApi(tree);
  });

  it('should vend the API Gateway website construct instead of CloudFront', async () => {
    await tsReactWebsiteGenerator(tree, options);

    expect(
      tree.exists(`${CONSTRUCTS_SRC}/core/api-gateway-static-website.ts`),
    ).toBe(true);
    expect(tree.exists(`${CONSTRUCTS_SRC}/core/static-website.ts`)).toBe(false);
    expect(read(tree, `${CONSTRUCTS_SRC}/core/index.ts`)).toContain(
      "export * from './api-gateway-static-website.js';",
    );
    expect(
      read(tree, `${CONSTRUCTS_SRC}/app/static-websites/website.ts`),
    ).toContain('extends ApiGatewayStaticWebsite');
    // A relative base, which the page and router resolve against its base href
    expect(read(tree, 'packages/website/vite.config.mts')).toContain(
      "base: './'",
    );
    expect(read(tree, 'packages/website/src/main.tsx')).toContain(
      'basepath: new URL(import.meta.env.BASE_URL, document.baseURI).pathname',
    );
    expect(read(tree, 'packages/website/index.html')).toContain(
      '<base href="%BASE_URL%" />',
    );
  });

  it('should change nothing when run again', async () => {
    await tsReactWebsiteGenerator(tree, options);
    const before = snapshotFiles(tree);

    await tsReactWebsiteGenerator(tree, options);

    expect(snapshotFiles(tree)).toEqual(before);
  });

  it('should replace the CloudFront website construct when switching hosting', async () => {
    await tsReactWebsiteGenerator(tree, { ...options, hosting: 'cloudfront' });
    expect(
      read(tree, `${CONSTRUCTS_SRC}/app/static-websites/website.ts`),
    ).toContain('extends StaticWebsite');

    await tsReactWebsiteGenerator(tree, options);

    expect(
      read(tree, `${CONSTRUCTS_SRC}/app/static-websites/website.ts`),
    ).toContain('extends ApiGatewayStaticWebsite');
    // The CloudFront core goes with its last website
    expect(tree.exists(`${CONSTRUCTS_SRC}/core/static-website.ts`)).toBe(false);
    expect(read(tree, `${CONSTRUCTS_SRC}/core/index.ts`)).not.toContain(
      './static-website.js',
    );
  });

  it('should refuse to switch a CloudFront website construct the user has changed', async () => {
    await tsReactWebsiteGenerator(tree, { ...options, hosting: 'cloudfront' });
    const construct = `${CONSTRUCTS_SRC}/app/static-websites/website.ts`;
    tree.write(construct, `${read(tree, construct)}\n// my change\n`);

    // Nx writes nothing from a generator that throws
    await expect(tsReactWebsiteGenerator(tree, options)).rejects.toThrow(
      'has changed since it was generated, so the website cannot be switched',
    );
    expect(read(tree, construct)).toContain('// my change');
    expect(read(tree, 'packages/website/vite.config.mts')).not.toContain(
      "'/prod/'",
    );
  });

  it('should keep a changed CloudFront core that no website uses now', async () => {
    await tsReactWebsiteGenerator(tree, { ...options, hosting: 'cloudfront' });
    const core = `${CONSTRUCTS_SRC}/core/static-website.ts`;
    tree.write(core, `${read(tree, core)}\n// my change\n`);

    await tsReactWebsiteGenerator(tree, options);

    expect(read(tree, core)).toContain('// my change');
    expect(read(tree, `${CONSTRUCTS_SRC}/core/index.ts`)).toContain(
      './static-website.js',
    );
  });

  it.each([
    [
      'an API with no infrastructure',
      { infra: 'none' },
      "has no infrastructure (infra 'none')",
    ],
    [
      'an HTTP API',
      { infra: 'http-lambda' },
      'can only be served through a REST API',
    ],
    ['a project that is not an API', undefined, 'is not an API project'],
  ])('should refuse %s', async (_, metadata, error) => {
    addProjectConfiguration(tree, '@proj/other', {
      root: 'packages/other',
      ...(metadata ? { metadata: { apiName: 'other', ...metadata } } : {}),
    } as Parameters<typeof addProjectConfiguration>[2]);
    await expect(
      tsReactWebsiteGenerator(tree, { ...options, apiProject: 'other' }),
    ).rejects.toThrow(error);
  });

  it('should refuse terraform', async () => {
    await expect(
      tsReactWebsiteGenerator(tree, { ...options, iac: 'terraform' }),
    ).rejects.toThrow('only supported with CDK');
  });

  it.each([
    [
      'packages/website/src/components/RuntimeConfig/index.tsx',
      "fetch('/runtime-config.json')",
    ],
    [
      'packages/website/src/components/CognitoAuth/index.tsx',
      'const cfg = { redirect_uri: window.location.origin };\nauth.signinRedirect();',
    ],
    [
      'packages/website/src/components/AppLayout/index.tsx',
      'signoutRedirect({ post_logout_redirect_uri: window.location.origin })',
    ],
    [
      `${CONSTRUCTS_SRC}/core/user-identity.ts`,
      'LOCAL_CALLBACK_URLS.concat(findCloudFrontDomainNames(this))',
    ],
  ])(
    'should stop, and point at the migrations, when %s predates what it needs',
    async (path, old) => {
      await tsReactWebsiteGenerator(tree, {
        ...options,
        hosting: 'cloudfront',
      });
      tree.write(path, old);

      await expect(tsReactWebsiteGenerator(tree, options)).rejects.toThrow(
        /was generated by an older version of @aws\/nx-plugin[\s\S]*Run 'nx migrate @aws\/nx-plugin'/,
      );
      expect(read(tree, path)).toBe(old);
    },
  );

  it('should stop when the API construct grants as it used to', async () => {
    const path = `${CONSTRUCTS_SRC}/app/apis/web-api.ts`;
    const old = read(tree, path).replace(
      /Token\.compareStrings\([^)]*\)/,
      'undefined',
    );
    tree.write(path, old);

    await expect(tsReactWebsiteGenerator(tree, options)).rejects.toThrow(
      `${path} was generated by an older version of @aws/nx-plugin`,
    );
  });
});

interface ConstructsModule {
  readonly UserIdentity: new (
    scope: Construct,
    id: string,
  ) => {
    readonly identityPool: { readonly authenticatedRole: IGrantable };
    readonly userPool: unknown;
    addCallbackUrl: (url: string) => void;
  };
  readonly WebApi: {
    new (
      scope: Construct,
      id: string,
      props: Record<string, unknown>,
    ): { readonly api: RestApi; grantInvokeAccess?: (g: IGrantable) => void };
    defaultIntegrations: (scope: Construct) => { build: () => unknown };
  };
  readonly Website: new (
    scope: Construct,
    id: string,
    props: { api: { api: RestApi } },
  ) => { readonly url: string; readonly urls: string[] };
}

describe('sign-in and sign-out redirects of a website served at several URLs', () => {
  const authDir = join(import.meta.dirname, '..', 'cognito-auth');
  const sources = [
    'files/app/components/CognitoAuth/index.tsx.template',
    'grit/cloudscape-auth-menu.grit',
    'grit/none-auth-menu.grit',
    'grit/shadcn-auth-menu.grit',
  ].map((file) => readFileSync(join(authDir, file), 'utf-8'));
  // Every redirect the vended auth code sends Cognito
  const redirects = sources.flatMap((source) =>
    [
      ...source.matchAll(
        /(?:post_logout_redirect_uri|redirect_uri):\s*([^\n]+?),?\n/g,
      ),
    ].map(([, expression]) =>
      expression.replace(/\\\\/g, '\\').replace(/,$/, ''),
    ),
  );
  // The URLs the construct registers, as the page at each is served
  const served = [
    'https://abc123.execute-api.ap-southeast-2.amazonaws.com/prod/',
    'https://app.example.com',
    'https://example.com/app/',
  ];

  it('should find every redirect', () => {
    expect(redirects).toHaveLength(7);
  });

  it.each(served)(
    'should return to %s, on the origin it started from',
    (url) => {
      // The page copy served at this URL names it as its base href
      const baseURI = url.endsWith('/') ? url : `${url}/`;
      for (const expression of redirects) {
        const redirect = new Function(
          'window',
          'document',
          'import_meta_env',
          `return ${expression.replace(/import\.meta\.env/g, 'import_meta_env')};`,
        )(
          { location: { origin: new URL(url).origin } },
          { baseURI },
          { BASE_URL: './' },
        ) as string;
        expect(new URL(redirect).origin).toBe(new URL(url).origin);
        // Exactly the callback URL the construct registers for this URL
        expect(redirect).toBe(url);
      }
    },
  );
});

describe.each<Auth>(['iam', 'cognito', 'custom'])(
  'website hosted through a REST API with %s auth',
  (auth) => {
    const tmpDir = join(
      import.meta.dirname,
      `_tmp_api-gateway-hosting-${auth}-${process.pid}`,
    );
    let sources: string[];
    let module: ConstructsModule;
    let template: Template;
    let stack: Stack;

    beforeAll(async () => {
      const tree = createTreeUsingTsSolutionSetup();
      await addRestApi(tree, auth);
      await tsReactWebsiteGenerator(tree, options);
      await addIdentityInfra(tree, {
        iac: 'cdk',
        cognitoDomain: 'test',
        allowSignup: true,
        localCallbackPorts: [4200],
      });
      const metadata = `export const OPERATION_DETAILS = {
  echo: { path: '/echo', method: 'GET' },
  getItem: { path: '/items/{id}', method: 'GET' },
  putItem: { path: '/items/{id}', method: 'PUT' },
}`;
      sources = writeSharedConstructs(tree, tmpDir, {
        [`${CONSTRUCTS_SRC}/generated/web-api/metadata.gen.ts`]: `${metadata} as const;\nexport type Operations = keyof typeof OPERATION_DETAILS;\n`,
        [`${CONSTRUCTS_SRC}/generated/web-api/metadata.gen.js`]: `${metadata};\n`,
        'dist/packages/web-api/bundle/index.js': '',
        'dist/packages/web-api/authorizer/index.js': '',
        'dist/packages/website/bundle/index.html': '<html></html>',
      });
      module = await importSharedConstructs<ConstructsModule>(tmpDir);

      stack = new Stack(new App(), 'Test');
      const identity = new module.UserIdentity(stack, 'Identity');
      const api = new module.WebApi(stack, 'WebApi', {
        integrations: module.WebApi.defaultIntegrations(stack).build(),
        ...(auth === 'cognito' ? { identity } : {}),
      });
      api.grantInvokeAccess?.(identity.identityPool.authenticatedRole);
      // The identity permits the website's callback on its own
      new module.Website(stack, 'Website', { api });
      // Fails on a dependency cycle
      template = Template.fromStack(stack);
    }, 120_000);

    afterAll(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    if (auth === 'iam') {
      it('should compile', () => {
        expect(typeCheck(sources)).toEqual([]);
      }, 120_000);
    }

    const methods = () =>
      Object.entries(template.findResources('AWS::ApiGateway::Method'))
        .filter(([, m]) => m.Properties.HttpMethod !== 'OPTIONS')
        .map(([id, m]) => ({ id, ...m.Properties }));
    const websiteMethods = () =>
      methods().filter((m) => m.Integration?.Type === 'AWS');

    it('should serve the website without authorization', () => {
      const routes = websiteMethods();
      expect(routes).toHaveLength(4);
      for (const route of routes) {
        expect(route.AuthorizationType).toBe('NONE');
        expect(route.AuthorizerId).toBeUndefined();
        expect(route.AuthorizationScopes).toBeUndefined();
      }
    });

    it("should keep the API's own authorization", () => {
      const expected = {
        iam: 'AWS_IAM',
        cognito: 'COGNITO_USER_POOLS',
        custom: 'CUSTOM',
      }[auth];
      const operations = methods().filter((m) => m.Integration?.Type !== 'AWS');
      expect(operations).toHaveLength(3);
      for (const operation of operations) {
        expect(operation.AuthorizationType).toBe(expected);
      }
    });

    const policyStatements = () =>
      Object.values(template.findResources('AWS::ApiGateway::RestApi'))[0]
        .Properties.Policy.Statement as Record<string, any>[];

    if (auth === 'iam') {
      it("should allow anyone the website's GETs, but not the API's IAM operations", () => {
        expect(policyStatements()).toEqual([
          expect.objectContaining({ Resource: 'execute-api:/*/OPTIONS/*' }),
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Principal: { AWS: '*' },
            NotResource: [
              'execute-api:/*/GET/echo',
              'execute-api:/*/GET/items/*',
              'execute-api:/*/POST/*',
              'execute-api:/*/PUT/*',
              'execute-api:/*/PATCH/*',
              'execute-api:/*/DELETE/*',
              'execute-api:/*/HEAD/*',
            ],
          },
        ]);
      });

      it.each([
        ['an operation at the root', 'ANY', (root: RestApi['root']) => root],
        [
          'a GET at a top-level path parameter',
          'GET',
          (root: RestApi['root']) => root.addResource('{id}'),
        ],
      ])('should refuse an API with %s', (_, method, at) => {
        const rootStack = new Stack(new App(), 'Root');
        const api = new module.WebApi(rootStack, 'WebApi', {
          integrations: module.WebApi.defaultIntegrations(rootStack).build(),
        });
        new module.Website(rootStack, 'Website', { api });
        // Added after the website, so found at synth
        at(api.api.root).addMethod(method, undefined, {
          authorizationType: AuthorizationType.IAM,
        });
        expect(() => Template.fromStack(rootStack)).toThrow(
          'which would take paths the website is served from',
        );
      });

      it('should let the S3 integration only read objects', () => {
        const statements = Object.entries(
          template.findResources('AWS::IAM::Policy'),
        )
          .filter(([id]) => id.startsWith('WebsiteS3IntegrationRole'))
          .flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
        expect(statements.map((st) => st.Action)).toEqual([
          's3:GetObject',
          'kms:Decrypt',
        ]);
      });

      const privateApi = (withEndpoints: boolean) => {
        const privateStack = new Stack(new App(), 'Private');
        const endpointOnly = {
          Effect: 'Allow',
          Principal: { AWS: '*' },
          Action: 'execute-api:Invoke',
          Resource: 'execute-api:/*',
          Condition: { StringEquals: { 'aws:SourceVpce': 'vpce-example' } },
        };
        const api = new module.WebApi(privateStack, 'WebApi', {
          integrations: module.WebApi.defaultIntegrations(privateStack).build(),
          endpointConfiguration: {
            types: [EndpointType.PRIVATE],
            ...(withEndpoints
              ? {
                  vpcEndpoints: [
                    InterfaceVpcEndpoint.fromInterfaceVpcEndpointAttributes(
                      privateStack,
                      'Endpoint',
                      { vpcEndpointId: 'vpce-example', port: 443 },
                    ),
                  ],
                }
              : {}),
          },
          policy: PolicyDocument.fromJson({
            Version: '2012-10-17',
            Statement: [endpointOnly],
          }),
        });
        new module.Website(privateStack, 'Website', { api });
        return { privateStack, endpointOnly };
      };

      it("should allow the website's routes on a private API through its endpoints alone", () => {
        const { privateStack, endpointOnly } = privateApi(true);
        const [restApi] = Object.values(
          Template.fromStack(privateStack).findResources(
            'AWS::ApiGateway::RestApi',
          ),
        );
        expect(restApi.Properties.Policy.Statement).toEqual([
          endpointOnly,
          expect.objectContaining({
            Effect: 'Allow',
            Condition: {
              StringEquals: { 'aws:SourceVpce': ['vpce-example'] },
            },
            NotResource: expect.arrayContaining(['execute-api:/*/GET/echo']),
          }),
        ]);
      });

      it('should refuse a private API that names no endpoints', () => {
        const { privateStack } = privateApi(false);
        Annotations.fromStack(privateStack).hasError(
          '*',
          Match.stringLikeRegexp('is private but names no VPC endpoints'),
        );
      });
    } else {
      it('should leave the open resource policy alone', () => {
        expect(policyStatements()).toEqual([
          expect.objectContaining({
            Effect: 'Allow',
            Resource: 'execute-api:/*',
          }),
        ]);
      });
    }

    // The URLs the website is served at do not depend on the API's auth
    if (auth !== 'iam') {
      return;
    }

    const certificate = (scope: Stack) =>
      Certificate.fromCertificateArn(
        scope,
        'Cert',
        'arn:aws:acm:ap-southeast-2:111111111111:certificate/example',
      );
    /** The website's URL and the base hrefs its pages are served with */
    const hosted = (
      name: string,
      wire: (scope: Stack, api: { api: RestApi }) => void,
      apiProps: Record<string, unknown> = {},
    ) => {
      const scope = new Stack(new App(), name);
      const identity = new module.UserIdentity(scope, 'Identity');
      const api = new module.WebApi(scope, 'WebApi', {
        integrations: module.WebApi.defaultIntegrations(scope).build(),
        ...(auth === 'cognito' ? { identity } : {}),
        ...apiProps,
      });
      const website = new module.Website(scope, 'Website', { api });
      wire(scope, api);
      const t = Template.fromStack(scope);
      const pages = Object.values(t.findResources('AWS::ApiGateway::Method'))
        .map(
          (m) =>
            m.Properties.Integration?.RequestTemplates?.['application/json'],
        )
        .filter((page) => JSON.stringify(page ?? '').includes('$page'))
        .map((page) => JSON.stringify(page));
      // The copies of index.html deployed, one for each base path
      const copies = Object.entries(
        t.findResources('Custom::CDKBucketDeployment'),
      )
        .filter(([id]) => id.startsWith('WebsitePagesDeployment'))
        .map(([, d]) => d.Properties.SourceObjectKeys.length);
      const [client] = Object.values(
        t.findResources('AWS::Cognito::UserPoolClient'),
      );
      return {
        url: JSON.stringify(scope.resolve(website.url)),
        urls: (scope.resolve(website.urls) as unknown[]).map((u) =>
          JSON.stringify(u),
        ),
        pages,
        copies,
        callbacks: JSON.stringify(client.Properties.CallbackURLs),
        callbackCount: (client.Properties.CallbackURLs as unknown[]).length,
        logouts: JSON.stringify(client.Properties.LogoutURLs),
        outputs: t.toJSON().Outputs as Record<string, { Value: unknown }>,
      };
    };

    it("should serve the pages under the stage's path on the execute-api URL", () => {
      const { url, urls, pages, copies, callbacks, callbackCount, logouts } =
        hosted('ExecuteApi', () => undefined);
      expect(url).toContain('execute-api');
      expect(urls).toEqual([url]);
      // The local dev server and the execute-api URL
      expect(callbackCount).toBe(2);
      expect(callbacks).toContain('execute-api');
      expect(logouts).toEqual(callbacks);
      // The root and every extensionless path
      expect(pages).toHaveLength(2);
      for (const page of pages) {
        expect(page).toContain("#set($base = '/prod/')");
        expect(page).toContain('#set($page = \\"_base${base}index.html\\")');
        expect(page).not.toContain('$context.domainName');
      }
      expect(copies).toEqual([1]);
    });

    it('should serve from every domain that maps the API, sorted, and permit sign-in to return to each', () => {
      const {
        url,
        urls,
        pages,
        copies,
        callbacks,
        callbackCount,
        logouts,
        outputs,
      } = hosted('TwoDomains', (scope, api) => {
        const cert = certificate(scope);
        // Mapped in the reverse of their sorted order
        new DomainName(scope, 'Other', {
          domainName: 'example.com',
          certificate: cert,
        }).addBasePathMapping(api.api, { basePath: 'app' });
        api.api.addDomainName('Domain', {
          domainName: 'app.example.com',
          certificate: cert,
        });
      });
      const app = /\{"Ref":"WebApiDomain\w+"\}/;
      const other = /\{"Ref":"Other\w+"\}/;
      // No domain is preferred: url is the execute-api URL
      expect(url).toContain('execute-api');
      expect(urls).toHaveLength(3);
      expect(urls[0]).toEqual(url);
      // Then by domain name: app.example.com before example.com
      expect(urls[1]).toMatch(app);
      expect(urls[2]).toMatch(new RegExp(`${other.source},"/app/"`));
      // The local dev server and every URL the website is served at
      expect(callbackCount).toBe(4);
      expect(callbacks).toMatch(app);
      expect(callbacks).toMatch(new RegExp(`${other.source},"/app/"`));
      expect(callbacks).toContain('execute-api');
      expect(logouts).toEqual(callbacks);
      // The existing output stays on the execute-api URL, and one lists them all
      const byName = (name: string) =>
        JSON.stringify(
          Object.entries(outputs).find(([k]) =>
            new RegExp(`^${name}[A-F0-9]{8}$`).test(k),
          )?.[1].Value,
        );
      const primary = byName('WebsiteWebsiteUrl');
      expect(primary).toContain('execute-api');
      expect(primary).not.toMatch(app);
      expect(primary).not.toMatch(other);
      const all = byName('WebsiteWebsiteUrls');
      expect(all).toContain('execute-api');
      expect(all).toMatch(app);
      expect(all).toMatch(other);
      // A copy for each domain's base path, and one for the stage
      expect(copies).toEqual([3]);
      for (const page of pages) {
        expect(page).toMatch(
          new RegExp(
            `\\$context\\.domainName == '",${app.source},"'\\)#set\\(\\$base = '/'\\)`,
          ),
        );
        expect(page).toMatch(
          new RegExp(
            `\\$context\\.domainName == '",${other.source},"'\\)#set\\(\\$base = '/app/'\\)`,
          ),
        );
      }
    });

    it('should sort the same URLs whatever order the domains are mapped in', () => {
      const wire =
        (names: string[]) => (scope: Stack, api: { api: RestApi }) => {
          const cert = certificate(scope);
          for (const name of names) {
            new DomainName(scope, name.replace(/\W/g, ''), {
              domainName: name,
              certificate: cert,
            }).addBasePathMapping(api.api);
          }
        };
      const names = ['b.example.com', 'a.example.com', 'c.example.com'];
      const order = (urls: string[]) =>
        urls.slice(1).map((u) => u.match(/"Ref":"(\w+?)[A-F0-9]{8}"/)?.[1]);
      const forward = hosted('Forward', wire(names));
      const reverse = hosted('Reverse', wire([...names].reverse()));
      expect(order(forward.urls)).toEqual([
        'aexamplecom',
        'bexamplecom',
        'cexamplecom',
      ]);
      expect(order(reverse.urls)).toEqual(order(forward.urls));
    });

    it('should answer a missing file with 404, whether S3 says 403 or 404', () => {
      for (const m of websiteMethods()) {
        const errors = m.Integration.IntegrationResponses.filter(
          (r: { StatusCode: string }) => r.StatusCode !== '200',
        );
        // API Gateway keeps one integration response per status code
        expect(errors).toEqual([
          expect.objectContaining({
            StatusCode: '404',
            SelectionPattern: '40[34]',
          }),
        ]);
      }
    });

    it('should pass every file through as it is, and choose only which copy of index.html', () => {
      const routes = Object.values(
        template.findResources('AWS::ApiGateway::Method'),
      )
        .filter((m) => m.Properties.Integration?.Type === 'AWS')
        .map((m) => m.Properties.Integration);
      for (const route of routes) {
        // A response template would turn a binary file into an error
        expect(route.IntegrationResponses[0].ResponseTemplates).toBeUndefined();
        expect(
          route.IntegrationResponses[0].ResponseParameters[
            'method.response.header.Content-Length'
          ],
        ).toBe('integration.response.header.Content-Length');
      }
      // The root and the single page app's paths choose a copy; the runtime
      // config and assets do not
      expect(
        routes.filter((r) =>
          JSON.stringify(r.RequestTemplates ?? '').includes('$page'),
        ),
      ).toHaveLength(2);
    });
  },
);
