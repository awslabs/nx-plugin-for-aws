/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { trpcAgentCoreHarnessConnectionGenerator } from './generator';

const ROUTER_TS = `import { echo } from './procedures/echo.js';
import { t } from './init.js';

export const router = t.router;

export const appRouter = router({
  echo,
});

export type AppRouter = typeof appRouter;
`;

const API_CONSTRUCT_TS = `import * as url from 'url';
import {
  AuthorizationType,
  LambdaIntegration,
  ResponseTransferMode,
} from 'aws-cdk-lib/aws-apigateway';
import { Aspects, Duration } from 'aws-cdk-lib';
import {
  PolicyDocument,
  PolicyStatement,
  Effect,
  AnyPrincipal,
  IGrantable,
  Grant,
} from 'aws-cdk-lib/aws-iam';
import {
  Code,
  Runtime,
  Function,
  FunctionProps,
  Tracing,
} from 'aws-cdk-lib/aws-lambda';
import { RuntimeConfig } from '../../core/runtime-config.js';
import { AddCorsPreflightAspect, RestApi } from '../../core/api/rest-api.js';

export class TestApi extends RestApi {
  private allowedOrigins = ['*'];

  constructor(scope, id, props) {
    super(scope, id, { ...props });
    Aspects.of(this).add(new AddCorsPreflightAspect(() => this.allowedOrigins));
  }

  public restrictCorsTo(...origins) {
    this.allowedOrigins = origins;
  }

  public grantInvokeAccess(grantee) {
    Grant.addToPrincipal({
      grantee,
      actions: ['execute-api:Invoke'],
      resourceArns: [this.api.arnForExecuteApi('*', '/*', '*')],
    });
  }
}
`;

describe('agentcore-harness#trpc-connection generator', () => {
  let tree: Tree;

  const setupTrpcApi = (
    name = 'api',
    overrides: Record<string, unknown> = {},
  ) => {
    addProjectConfiguration(tree, name, {
      name,
      root: `packages/${name}`,
      sourceRoot: `packages/${name}/src`,
      targets: {},
      metadata: {
        generator: 'ts#trpc-api',
        apiName: name,
        apiType: 'trpc',
        auth: 'iam',
        infra: 'rest-lambda',
        integrationPattern: 'shared',
        iac: 'cdk',
        ...overrides,
      } as any,
    });
    tree.write(`packages/${name}/src/router.ts`, ROUTER_TS);
    tree.write(
      `packages/${name}/package.json`,
      JSON.stringify({ name, type: 'module' }),
    );
  };

  const setupHarness = (
    name = 'harness',
    overrides: Record<string, unknown> = {},
  ) => {
    addProjectConfiguration(tree, name, {
      name,
      root: `packages/${name}`,
      targets: {},
      metadata: {
        generator: 'agentcore-harness',
        name: 'my-harness',
        rc: 'MyHarness',
        auth: 'iam',
        iac: 'cdk',
        ...overrides,
      } as any,
    });
  };

  const setupApiConstruct = (apiNameKebabCase = 'api') => {
    tree.write(
      `packages/common/constructs/src/app/apis/${apiNameKebabCase}.ts`,
      API_CONSTRUCT_TS,
    );
  };

  const setupHarnessConstruct = (harnessNameKebabCase = 'my-harness') => {
    tree.write(
      `packages/common/constructs/src/app/harnesses/${harnessNameKebabCase}/${harnessNameKebabCase}.ts`,
      `export class MyHarness {}\n`,
    );
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('throws for an api not generated with infra: rest-lambda', async () => {
    setupTrpcApi('api', { infra: 'http-lambda' });
    setupHarness('harness');

    await expect(
      trpcAgentCoreHarnessConnectionGenerator(tree, {
        sourceProject: 'api',
        targetProject: 'harness',
      }),
    ).rejects.toThrow(/infra: 'rest-lambda'/);
  });

  it('generates the agui route handler, mapper and session helper', async () => {
    setupTrpcApi();
    setupHarness();
    setupApiConstruct();
    setupHarnessConstruct();

    await trpcAgentCoreHarnessConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'harness',
    });

    expect(tree.exists('packages/api/src/agui/handler.ts')).toBe(true);
    expect(tree.exists('packages/api/src/agui/converse-to-agui.ts')).toBe(
      true,
    );
    expect(tree.exists('packages/api/src/agui/session.ts')).toBe(true);
    expect(
      tree.read('packages/api/src/agui/handler.ts', 'utf-8'),
    ).toMatchSnapshot('handler.ts');
    expect(
      tree.read('packages/api/src/agui/converse-to-agui.ts', 'utf-8'),
    ).toMatchSnapshot('converse-to-agui.ts');
    expect(
      tree.read('packages/api/src/agui/session.ts', 'utf-8'),
    ).toMatchSnapshot('session.ts');
  });

  it('generates and registers the optional history procedure', async () => {
    setupTrpcApi();
    setupHarness();
    setupApiConstruct();
    setupHarnessConstruct();

    await trpcAgentCoreHarnessConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'harness',
    });

    expect(tree.exists('packages/api/src/procedures/history.ts')).toBe(true);
    const router = tree.read('packages/api/src/router.ts', 'utf-8')!;
    expect(router).toContain("import { history } from './procedures/history.js';");
    expect(router.replace(/\s+/g, ' ')).toContain('router({ echo, history })');
  });

  it('does not overwrite an existing agui handler', async () => {
    setupTrpcApi();
    setupHarness();
    setupApiConstruct();
    setupHarnessConstruct();
    tree.write('packages/api/src/agui/handler.ts', '// custom content');

    await trpcAgentCoreHarnessConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'harness',
    });

    expect(
      tree.read('packages/api/src/agui/handler.ts', 'utf-8')?.trim(),
    ).toBe('// custom content');
  });

  it('adds an addAguiRoute method to the api CDK construct', async () => {
    setupTrpcApi();
    setupHarness();
    setupApiConstruct();
    setupHarnessConstruct();

    await trpcAgentCoreHarnessConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'harness',
    });

    const construct = tree.read(
      'packages/common/constructs/src/app/apis/api.ts',
      'utf-8',
    )!;
    expect(construct).toContain('public addAguiRoute(harness: MyHarness)');
    expect(construct).toContain("this.api.root.addResource('agui')");
    expect(construct).toContain('harness.grantInvokeAccess(aguiHandler)');
    expect(construct).toMatchSnapshot('api-construct.ts');
  });

  it('records connection metadata on the source project', async () => {
    setupTrpcApi();
    setupHarness();
    setupApiConstruct();
    setupHarnessConstruct();

    await trpcAgentCoreHarnessConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'harness',
    });

    const { readProjectConfiguration } = await import('@nx/devkit');
    const config = readProjectConfiguration(tree, 'api');
    expect((config.metadata as any).components).toContainEqual(
      expect.objectContaining({
        generator: 'agentcore-harness#trpc-connection',
        name: 'MyHarness',
      }),
    );
  });

  it('warns and skips the infra patch when the harness has no generated CDK construct', async () => {
    setupTrpcApi();
    setupHarness('harness', { iac: undefined });
    setupApiConstruct();
    // No harness construct file generated (infra: 'none' on the harness).

    await trpcAgentCoreHarnessConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'harness',
    });

    const construct = tree.read(
      'packages/common/constructs/src/app/apis/api.ts',
      'utf-8',
    )!;
    expect(construct).not.toContain('addAguiRoute');
    // Application code is still generated regardless of the infra patch.
    expect(tree.exists('packages/api/src/agui/handler.ts')).toBe(true);
  });

  it('warns and skips the infra patch for terraform apis', async () => {
    setupTrpcApi('api', { iac: 'terraform' });
    setupHarness();
    setupHarnessConstruct();

    await trpcAgentCoreHarnessConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'harness',
    });

    expect(tree.exists('packages/api/src/agui/handler.ts')).toBe(true);
    expect(
      tree.exists('packages/common/constructs/src/app/apis/api.ts'),
    ).toBe(false);
  });

  it('is idempotent when re-run with the same inputs', async () => {
    setupTrpcApi();
    setupHarness();
    setupApiConstruct();
    setupHarnessConstruct();

    const run = () =>
      trpcAgentCoreHarnessConnectionGenerator(tree, {
        sourceProject: 'api',
        targetProject: 'harness',
      });

    await run();
    const handlerAfterFirst = tree.read(
      'packages/api/src/agui/handler.ts',
      'utf-8',
    );
    const routerAfterFirst = tree.read('packages/api/src/router.ts', 'utf-8');
    const constructAfterFirst = tree.read(
      'packages/common/constructs/src/app/apis/api.ts',
      'utf-8',
    );

    await run();

    expect(tree.read('packages/api/src/agui/handler.ts', 'utf-8')).toEqual(
      handlerAfterFirst,
    );
    expect(tree.read('packages/api/src/router.ts', 'utf-8')).toEqual(
      routerAfterFirst,
    );
    expect(
      tree.read('packages/common/constructs/src/app/apis/api.ts', 'utf-8'),
    ).toEqual(constructAfterFirst);
  });
});
