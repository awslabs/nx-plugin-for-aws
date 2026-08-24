/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const CORE_INDEX = 'packages/common/constructs/src/core/index.ts';
const CLOUDFRONT_CORE_FILE =
  'packages/common/constructs/src/core/cloudfront.ts';
const API_APP_FILE = 'packages/common/constructs/src/app/apis/test-api.ts';
const USER_IDENTITY_FILE =
  'packages/common/constructs/src/core/user-identity.ts';

const OLD_INDEX = `export * from './app.js';
export * from './checkov.js';
export * from './runtime-config.js';
export * from './workspace.js';
`;

const OLD_API_APP_FILE = `import { Construct } from 'constructs';
import { Distribution } from 'aws-cdk-lib/aws-cloudfront';
import {
  ApiIntegrations,
  IntegrationBuilder,
  RestApiIntegration,
} from '../../core/api/utils.js';
import { AddCorsPreflightAspect, RestApi } from '../../core/api/rest-api.js';

export class TestApi extends RestApi {
  private allowedOrigins: readonly string[] = ['*'];

  public restrictCorsTo(
    ...origins: (string | Distribution | { cloudFrontDistribution: Distribution })[]
  ) {
    const allowedOrigins = origins.map((origin) =>
      typeof origin === 'string'
        ? origin
        : 'cloudFrontDistribution' in origin
          ? \`https://\${origin.cloudFrontDistribution.distributionDomainName}\`
          : \`https://\${origin.distributionDomainName}\`,
    );

    this.allowedOrigins = allowedOrigins;
  }
}
`;

const OLD_USER_IDENTITY_FILE = `import { Construct } from 'constructs';
import { Stack } from 'aws-cdk-lib';
import { UserPool, UserPoolClient } from 'aws-cdk-lib/aws-cognito';
import { CfnDistribution, Distribution } from 'aws-cdk-lib/aws-cloudfront';
import { suppressRules } from './checkov.js';

const WEB_CLIENT_ID = 'WebClient';

export class UserIdentity extends Construct {
  private createUserPoolClient = (userPool: UserPool) => {
    const lazilyComputedCallbackUrls = Lazy.list({
      produce: () =>
        ['http://localhost:4200', 'http://localhost:4300'].concat(
          this.findCloudFrontDomainNames().map((domain) => \`https://\${domain}\`),
        ),
    });

    return userPool.addClient(WEB_CLIENT_ID, {
      oAuth: {
        callbackUrls: lazilyComputedCallbackUrls,
        logoutUrls: lazilyComputedCallbackUrls,
      },
    });
  };

  // Includes each distribution's default domain name plus any custom domain names (aliases) configured on it.
  private findCloudFrontDomainNames = (): string[] =>
    Stack.of(this)
      .node.findAll()
      .filter((child): child is Distribution => child instanceof Distribution)
      .flatMap((d) => {
        const cfnDistribution = d.node.defaultChild as CfnDistribution;
        const distributionConfig =
          cfnDistribution.distributionConfig as CfnDistribution.DistributionConfigProperty;
        return [d.domainName, ...(distributionConfig.aliases ?? [])];
      });
}
`;

describe('restrict-cors-to-custom-domains migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when common/constructs does not exist', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
    expect(tree.exists(CLOUDFRONT_CORE_FILE)).toBeFalsy();
  });

  it('should apply to the shape your generators produce', async () => {
    tree.write(CORE_INDEX, OLD_INDEX);
    tree.write(API_APP_FILE, OLD_API_APP_FILE);
    tree.write(USER_IDENTITY_FILE, OLD_USER_IDENTITY_FILE);

    const result = await migration(tree);

    // Adds the shared helper and exports it
    expect(tree.exists(CLOUDFRONT_CORE_FILE)).toBeTruthy();
    expect(tree.read(CLOUDFRONT_CORE_FILE, 'utf-8')).toContain(
      'export const findCloudFrontDomainNames',
    );
    expect(tree.read(CORE_INDEX, 'utf-8')).toContain(
      "export * from './cloudfront.js';",
    );

    // Updates restrictCorsTo and its import
    const apiContent = tree.read(API_APP_FILE, 'utf-8');
    expect(apiContent).toContain('origins.flatMap((origin) =>');
    expect(apiContent).toContain('findCloudFrontDomainNames(');
    expect(apiContent).toContain(
      "import { findCloudFrontDomainNames } from '../../core/cloudfront.js';",
    );
    expect(apiContent).not.toContain('distributionDomainName');

    // Updates UserIdentity to reuse the shared helper
    const identityContent = tree.read(USER_IDENTITY_FILE, 'utf-8');
    expect(identityContent).toContain(
      "import { findCloudFrontDomainNames } from './cloudfront.js';",
    );
    expect(identityContent).toContain('.flatMap(findCloudFrontDomainNames)');
    expect(identityContent).not.toContain('private findCloudFrontDomainNames');
    expect(identityContent).not.toContain('CfnDistribution');

    // Nothing left for the user to do, so nothing is reported.
    expect(result.nextSteps).toEqual([]);
  });

  it('should skip and report a customised restrictCorsTo', async () => {
    tree.write(CORE_INDEX, OLD_INDEX);
    const customised = OLD_API_APP_FILE.replace(
      "typeof origin === 'string'\n        ? origin",
      "typeof origin === 'string'\n        ? origin.toUpperCase()",
    );
    tree.write(API_APP_FILE, customised);

    const result = await migration(tree);

    // Left alone (formatFilesInSubtree may still reformat whitespace, but the
    // customisation and old shape must survive untouched).
    const apiContent = tree.read(API_APP_FILE, 'utf-8');
    expect(apiContent).toContain('origin.toUpperCase()');
    expect(apiContent).toContain('distributionDomainName');
    expect(apiContent).not.toContain('findCloudFrontDomainNames(');
    expect(result.nextSteps.some((c) => c.includes(API_APP_FILE))).toBeTruthy();
  });

  it('should apply the UserIdentity fix while preserving an added allowed origin', async () => {
    tree.write(CORE_INDEX, OLD_INDEX);
    const customised = OLD_USER_IDENTITY_FILE.replace(
      "'http://localhost:4200', 'http://localhost:4300'",
      "'http://localhost:4200', 'http://localhost:4300', 'https://my-custom-preview.example.com'",
    );
    tree.write(USER_IDENTITY_FILE, customised);

    const result = await migration(tree);

    // The added origin is unrelated to the call site the fix targets, so it's
    // preserved while the fix is still applied.
    const identityContent = tree.read(USER_IDENTITY_FILE, 'utf-8');
    expect(identityContent).toContain('https://my-custom-preview.example.com');
    expect(identityContent).toContain('.flatMap(findCloudFrontDomainNames)');
    expect(identityContent).not.toContain('private findCloudFrontDomainNames');
    expect(result.nextSteps).toEqual([]);
  });

  it('should skip and report a UserIdentity with a renamed call site', async () => {
    tree.write(CORE_INDEX, OLD_INDEX);
    const customised = OLD_USER_IDENTITY_FILE.replace(
      'this.findCloudFrontDomainNames()',
      'this.getAllowedDomains()',
    ).replace('private findCloudFrontDomainNames', 'private getAllowedDomains');
    tree.write(USER_IDENTITY_FILE, customised);

    const result = await migration(tree);

    const identityContent = tree.read(USER_IDENTITY_FILE, 'utf-8');
    expect(identityContent).toContain('private getAllowedDomains');
    expect(identityContent).not.toContain(
      '.flatMap(findCloudFrontDomainNames)',
    );
    expect(
      result.nextSteps.some((c) => c.includes(USER_IDENTITY_FILE)),
    ).toBeTruthy();
  });

  it('should be idempotent', async () => {
    tree.write(CORE_INDEX, OLD_INDEX);
    tree.write(API_APP_FILE, OLD_API_APP_FILE);
    tree.write(USER_IDENTITY_FILE, OLD_USER_IDENTITY_FILE);

    await migration(tree);
    const apiAfterFirst = tree.read(API_APP_FILE, 'utf-8');
    const identityAfterFirst = tree.read(USER_IDENTITY_FILE, 'utf-8');
    const indexAfterFirst = tree.read(CORE_INDEX, 'utf-8');

    const secondResult = await migration(tree);

    expect(tree.read(API_APP_FILE, 'utf-8')).toEqual(apiAfterFirst);
    expect(tree.read(USER_IDENTITY_FILE, 'utf-8')).toEqual(identityAfterFirst);
    expect(tree.read(CORE_INDEX, 'utf-8')).toEqual(indexAfterFirst);
    expect(secondResult.nextSteps).toEqual([]);
  });
});
