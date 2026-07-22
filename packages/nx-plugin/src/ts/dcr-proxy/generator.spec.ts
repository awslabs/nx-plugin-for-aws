/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { getNpmScopePrefix } from '../../utils/npm-scope';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { TS_DCR_PROXY_GENERATOR_INFO, tsDcrProxyGenerator } from './generator';

describe('ts#dcr-proxy generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const constructDir =
    'packages/common/constructs/src/app/dcr-proxies/my-proxy';
  const handlerProjectDir = 'my-proxy';

  it('generates a standalone handler project and the shared construct', async () => {
    await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'cdk' });

    // A standalone TypeScript project holds the bundled handlers
    expect(tree.exists(`${handlerProjectDir}/project.json`)).toBe(true);

    // The construct lives in the shared constructs package
    expect(tree.exists('packages/common/constructs/project.json')).toBe(true);
    expect(tree.exists(`${constructDir}/my-proxy.ts`)).toBe(true);
  });

  it('defaults the name to dcr-proxy when none is given', async () => {
    await tsDcrProxyGenerator(tree, { iac: 'cdk' });

    const defaultDir =
      'packages/common/constructs/src/app/dcr-proxies/dcr-proxy';
    expect(tree.exists(`${defaultDir}/dcr-proxy.ts`)).toBe(true);

    const construct = tree.read(`${defaultDir}/dcr-proxy.ts`, 'utf-8');
    expect(construct).toContain('export class DcrProxy extends Construct');
  });

  it('generates the construct and its 6 lambda handlers', async () => {
    await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'cdk' });

    expect(tree.exists(`${constructDir}/my-proxy.ts`)).toBe(true);
    for (const handler of [
      'authorization-server-metadata',
      'authorize',
      'mcp-proxy',
      'protected-resource-metadata',
      'register',
      'token',
    ]) {
      expect(
        tree.exists(`${handlerProjectDir}/src/handlers/${handler}.ts`),
      ).toBe(true);
    }
  });

  it('exports the construct from the shared constructs app index', async () => {
    await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'cdk' });

    expect(
      tree.read(
        'packages/common/constructs/src/app/dcr-proxies/index.ts',
        'utf-8',
      ),
    ).toContain("export * from './my-proxy/my-proxy.js'");
    expect(
      tree.read('packages/common/constructs/src/app/index.ts', 'utf-8'),
    ).toContain("export * from './dcr-proxies/index.js'");
  });

  it('adds the lambda handler dependencies', async () => {
    await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'cdk' });

    const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(
      rootPackageJson.dependencies['@aws-sdk/client-secrets-manager'],
    ).toBeDefined();
    expect(rootPackageJson.devDependencies['@types/aws-lambda']).toBeDefined();
  });

  it('names the construct class from the given name', async () => {
    await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'cdk' });

    const construct = tree.read(`${constructDir}/my-proxy.ts`, 'utf-8');
    expect(construct).toContain('export class MyProxy extends Construct');
    expect(construct).toContain('export interface MyProxyProps');
  });

  it('references the rolldown bundles via Code.fromAsset', async () => {
    await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'cdk' });

    const construct = tree.read(`${constructDir}/my-proxy.ts`, 'utf-8');
    expect(construct).toContain('new lambda.Function');
    expect(construct).toContain('lambda.Code.fromAsset');
    expect(construct).toContain("handler: 'index.handler'");
    expect(construct).not.toContain('aws-lambda-nodejs');
  });

  it('adds a rolldown bundle entry per handler to the project', async () => {
    await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'cdk' });

    const rolldownConfig = tree.read(
      `${handlerProjectDir}/rolldown.config.ts`,
      'utf-8',
    );
    for (const handler of [
      'authorization-server-metadata',
      'authorize',
      'mcp-proxy',
      'protected-resource-metadata',
      'register',
      'token',
    ]) {
      expect(rolldownConfig).toContain(`src/handlers/${handler}.ts`);
    }
  });

  it('grants the token handler read access to the client secret only', async () => {
    await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'cdk' });

    const construct = tree.read(`${constructDir}/my-proxy.ts`, 'utf-8');
    expect(construct).toContain('clientSecret.grantRead(tokenFn)');
  });

  it('resolves iac from config when set to inherit', async () => {
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, { iac: { provider: 'cdk' } });

    await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'inherit' });

    expect(tree.exists('packages/common/constructs')).toBe(true);
    expect(tree.exists(`${constructDir}/my-proxy.ts`)).toBe(true);
  });

  it('is idempotent when re-run with the same options', async () => {
    const options = { name: 'my-proxy', iac: 'cdk' as const };
    await tsDcrProxyGenerator(tree, options);
    const first = tree.read(`${constructDir}/my-proxy.ts`, 'utf-8');

    await tsDcrProxyGenerator(tree, options);
    const second = tree.read(`${constructDir}/my-proxy.ts`, 'utf-8');

    expect(second).toEqual(first);

    // Exports should not be duplicated
    const appIndex = tree.read(
      'packages/common/constructs/src/app/index.ts',
      'utf-8',
    );
    expect(appIndex.match(/dcr-proxies\/index\.js/g)).toHaveLength(1);
  });

  it('supports multiple dcr proxies without clashing', async () => {
    await tsDcrProxyGenerator(tree, { name: 'first-proxy', iac: 'cdk' });
    await tsDcrProxyGenerator(tree, { name: 'second-proxy', iac: 'cdk' });

    expect(
      tree.exists(
        'packages/common/constructs/src/app/dcr-proxies/first-proxy/first-proxy.ts',
      ),
    ).toBe(true);
    expect(
      tree.exists(
        'packages/common/constructs/src/app/dcr-proxies/second-proxy/second-proxy.ts',
      ),
    ).toBe(true);

    const index = tree.read(
      'packages/common/constructs/src/app/dcr-proxies/index.ts',
      'utf-8',
    );
    expect(index).toContain("export * from './first-proxy/first-proxy.js'");
    expect(index).toContain("export * from './second-proxy/second-proxy.js'");
  });

  it('adds generator metric metadata', async () => {
    await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'cdk' });

    expectHasMetricTags(tree, TS_DCR_PROXY_GENERATOR_INFO.metric);
  });

  it('matches snapshot for generated construct and a handler', async () => {
    await tsDcrProxyGenerator(tree, { name: 'snapshot-proxy', iac: 'cdk' });

    const construct = tree.read(
      'packages/common/constructs/src/app/dcr-proxies/snapshot-proxy/snapshot-proxy.ts',
      'utf-8',
    );
    expect(construct).toMatchSnapshot('dcr-proxy-construct.ts');

    for (const handler of [
      'authorization-server-metadata',
      'authorize',
      'mcp-proxy',
      'protected-resource-metadata',
      'register',
      'token',
    ]) {
      const handlerContent = tree.read(
        `snapshot-proxy/src/handlers/${handler}.ts`,
        'utf-8',
      );
      expect(handlerContent).toMatchSnapshot(`dcr-proxy-${handler}-handler.ts`);
    }
  });

  describe('terraform', () => {
    const tfDir = 'packages/common/terraform/src/app/dcr-proxies/my-proxy';

    it('generates the terraform module instead of a cdk construct', async () => {
      await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'terraform' });

      expect(tree.exists(`${tfDir}/my-proxy.tf`)).toBe(true);
      expect(tree.exists(`${constructDir}/my-proxy.ts`)).toBe(false);
    });

    it('reuses the shared core http-api module', async () => {
      await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'terraform' });

      expect(
        tree.exists(
          'packages/common/terraform/src/core/api/http-api/http-api.tf',
        ),
      ).toBe(true);

      const tf = tree.read(`${tfDir}/my-proxy.tf`, 'utf-8');
      expect(tf).toContain('module "http_api"');
      expect(tf).toContain('source = "../../../core/api/http-api"');
    });

    it('wires all seven routes including the well-known and mcp paths', async () => {
      await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'terraform' });

      const tf = tree.read(`${tfDir}/my-proxy.tf`, 'utf-8');
      expect(tf).toContain('GET /.well-known/oauth-protected-resource');
      expect(tf).toContain('GET /.well-known/oauth-authorization-server');
      expect(tf).toContain('GET /.well-known/openid-configuration');
      expect(tf).toContain('POST /register');
      expect(tf).toContain('GET /authorize');
      expect(tf).toContain('POST /oauth/token');
      expect(tf).toContain('ANY /mcp');
    });

    it('grants only the token handler read access to the client secret', async () => {
      await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'terraform' });

      const tf = tree.read(`${tfDir}/my-proxy.tf`, 'utf-8');
      expect(tf).toContain('data "aws_secretsmanager_secret"');
      expect(tf).toContain('secretsmanager:GetSecretValue');
      expect(tf).toContain('aws_iam_role_policy" "token_secret_read"');
    });

    it('configures the mcp proxy handler with the upstream url', async () => {
      await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'terraform' });

      const tf = tree.read(`${tfDir}/my-proxy.tf`, 'utf-8');
      expect(tf).toContain('UPSTREAM_URL');
      expect(tf).toContain('var.mcp_proxy_timeout');
    });

    it('makes the shared terraform build depend on the handler project', async () => {
      await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'terraform' });

      const projectJson = JSON.parse(
        tree.read('packages/common/terraform/project.json', 'utf-8'),
      );
      expect(projectJson.targets.build.dependsOn).toContain(
        `${getNpmScopePrefix(tree)}my-proxy:build`,
      );
    });

    it('adds the lambda handler dependencies', async () => {
      await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'terraform' });

      const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
      expect(
        rootPackageJson.dependencies['@aws-sdk/client-secrets-manager'],
      ).toBeDefined();
      expect(
        rootPackageJson.devDependencies['@types/aws-lambda'],
      ).toBeDefined();
    });

    it('is idempotent when re-run with the same options', async () => {
      const options = { name: 'my-proxy', iac: 'terraform' as const };
      await tsDcrProxyGenerator(tree, options);
      const first = tree.read(`${tfDir}/my-proxy.tf`, 'utf-8');

      await tsDcrProxyGenerator(tree, options);
      const second = tree.read(`${tfDir}/my-proxy.tf`, 'utf-8');

      expect(second).toEqual(first);
    });

    it('matches snapshot for the generated terraform module', async () => {
      await tsDcrProxyGenerator(tree, {
        name: 'snapshot-proxy',
        iac: 'terraform',
      });

      const tf = tree.read(
        'packages/common/terraform/src/app/dcr-proxies/snapshot-proxy/snapshot-proxy.tf',
        'utf-8',
      );
      expect(tf).toMatchSnapshot('dcr-proxy-module.tf');
    });
  });
});
