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
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { TS_DCR_PROXY_GENERATOR_INFO, tsDcrProxyGenerator } from './generator';

describe('ts#dcr-proxy generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const constructDir =
    'packages/common/constructs/src/app/dcr-proxies/my-proxy';

  it('generates only into the shared constructs package (no standalone project)', async () => {
    await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'cdk' });

    // No standalone project is created for the proxy
    expect(tree.exists('packages/my-proxy/project.json')).toBe(false);

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
      expect(tree.exists(`${constructDir}/handlers/${handler}.ts`)).toBe(true);
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

  it('uses NodejsFunction bundling for the TypeScript handlers', async () => {
    await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'cdk' });

    const construct = tree.read(`${constructDir}/my-proxy.ts`, 'utf-8');
    expect(construct).toContain("from 'aws-cdk-lib/aws-lambda-nodejs'");
    expect(construct).toContain('new nodejs.NodejsFunction');
    expect(construct).toContain("externalModules: ['@aws-sdk/*']");
  });

  it('grants the token handler read access to the client secret only', async () => {
    await tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'cdk' });

    const construct = tree.read(`${constructDir}/my-proxy.ts`, 'utf-8');
    expect(construct).toContain('clientSecret.grantRead(tokenFn)');
  });

  it('throws when the resolved IaC provider is terraform', async () => {
    await expect(
      tsDcrProxyGenerator(tree, { name: 'my-proxy', iac: 'terraform' }),
    ).rejects.toThrow(/only supports the 'cdk' IaC provider/);

    expect(tree.exists(`${constructDir}/my-proxy.ts`)).toBe(false);
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

    const tokenHandler = tree.read(
      'packages/common/constructs/src/app/dcr-proxies/snapshot-proxy/handlers/token.ts',
      'utf-8',
    );
    expect(tokenHandler).toMatchSnapshot('dcr-proxy-token-handler.ts');
  });
});
