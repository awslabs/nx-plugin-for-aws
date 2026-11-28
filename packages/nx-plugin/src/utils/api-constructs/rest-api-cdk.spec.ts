/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// @vitest-environment node
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { EndpointType } from 'aws-cdk-lib/aws-apigateway';
import {
  AnyPrincipal,
  type IGrantable,
  PolicyDocument,
  PolicyStatement,
} from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { declareDependencies } from '../declared-dependencies.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../shared-constructs.js';
import {
  importSharedConstructs,
  typeCheck,
  writeSharedConstructs,
} from '../test/cdk-constructs.js';
import { createTreeUsingTsSolutionSetup } from '../test.js';
import {
  API_CONSTRUCTS_DEPENDENCIES,
  addApiGatewayInfra,
} from './api-constructs.js';

// Inside this package so aws-cdk-lib resolves; `_tmp_*` is git-ignored.
const TMP_DIR = join(import.meta.dirname, `_tmp_rest-api-${process.pid}`);

interface ConstructsModule {
  readonly WebApi: {
    new (
      scope: Construct,
      id: string,
      props: { integrations: unknown } & Record<string, unknown>,
    ): {
      readonly api: import('aws-cdk-lib/aws-apigateway').RestApi;
      grantInvokeAccess: (grantee: IGrantable) => void;
    };
    defaultIntegrations: (scope: Construct) => { build: () => unknown };
  };
}

describe('REST API construct (iam)', () => {
  let module: ConstructsModule;

  beforeAll(async () => {
    const tree = createTreeUsingTsSolutionSetup();
    const declaration = declareDependencies()({
      ts: [...SHARED_CONSTRUCTS_DEPENDENCIES, ...API_CONSTRUCTS_DEPENDENCIES],
    });
    await sharedConstructsGenerator(tree, { iac: 'cdk' }, declaration);
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
        },
        auth: 'iam',
      },
      declaration,
    );
    const metadata = `export const OPERATION_DETAILS = { echo: { path: '/echo', method: 'GET' } } as const;
export type Operations = keyof typeof OPERATION_DETAILS;`;
    writeSharedConstructs(tree, TMP_DIR, {
      'packages/common/constructs/src/generated/web-api/metadata.gen.ts':
        metadata,
      'packages/common/constructs/src/generated/web-api/metadata.gen.js': `export const OPERATION_DETAILS = { echo: { path: '/echo', method: 'GET' } };`,
      'dist/packages/web-api/bundle/index.js': '',
    });
    module = await importSharedConstructs<ConstructsModule>(TMP_DIR);
  });

  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('should accept a private endpoint and a resource policy that replaces the default', () => {
    const stack = new Stack(new App(), 'Test');
    new module.WebApi(stack, 'WebApi', {
      integrations: module.WebApi.defaultIntegrations(stack).build(),
      endpointConfiguration: { types: [EndpointType.PRIVATE] },
      policy: new PolicyDocument({
        statements: [
          new PolicyStatement({
            principals: [new AnyPrincipal()],
            actions: ['execute-api:Invoke'],
            resources: ['execute-api:/*'],
            conditions: { StringEquals: { 'aws:SourceVpce': 'vpce-example' } },
          }),
        ],
      }),
    });

    Template.fromStack(stack).hasResourceProperties(
      'AWS::ApiGateway::RestApi',
      {
        EndpointConfiguration: { Types: ['PRIVATE'] },
        Policy: {
          Statement: [
            {
              Action: 'execute-api:Invoke',
              Condition: { StringEquals: { 'aws:SourceVpce': 'vpce-example' } },
              Effect: 'Allow',
              Principal: { AWS: '*' },
              Resource: 'execute-api:/*',
            },
          ],
          Version: '2012-10-17',
        },
      },
    );
  });
});

describe('REST API construct props', () => {
  const tmpDir = join(
    import.meta.dirname,
    `_tmp_rest-api-props-${process.pid}`,
  );

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should type the private props, for an API named after the CDK class too', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    const declaration = declareDependencies()({
      ts: [...SHARED_CONSTRUCTS_DEPENDENCIES, ...API_CONSTRUCTS_DEPENDENCIES],
    });
    await sharedConstructsGenerator(tree, { iac: 'cdk' }, declaration);
    await addApiGatewayInfra(
      tree,
      {
        iac: 'cdk',
        apiProjectName: '@proj/rest-api',
        apiNameClassName: 'RestApi',
        apiNameKebabCase: 'rest-api',
        constructType: 'rest',
        backend: {
          type: 'smithy',
          integrationPattern: 'isolated',
          bundleOutputDir: 'dist/packages/rest-api/bundle',
        },
        auth: 'iam',
      },
      declaration,
    );
    const metadata = `export const OPERATION_DETAILS = { echo: { path: '/echo', method: 'GET' } } as const;
export type Operations = keyof typeof OPERATION_DETAILS;`;
    const check = 'packages/common/constructs/src/props-check.ts';
    const sources = writeSharedConstructs(tree, tmpDir, {
      'packages/common/constructs/src/generated/rest-api/metadata.gen.ts':
        metadata,
      [check]: `import { App, Stack } from 'aws-cdk-lib';
import { EndpointType } from 'aws-cdk-lib/aws-apigateway';
import { PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { RestApi } from './app/apis/rest-api.js';

const stack = new Stack(new App(), 'Check');
new RestApi(stack, 'Api', {
  integrations: RestApi.defaultIntegrations(stack).build(),
  endpointConfiguration: { types: [EndpointType.PRIVATE] },
  policy: new PolicyDocument(),
});
`,
    });
    expect(
      typeCheck(sources).filter(
        (d) => d.includes('/apis/rest-api.ts') || d.includes('props-check.ts'),
      ),
    ).toEqual([]);
  }, 120_000);
});
