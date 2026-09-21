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

  // The two rendered forms of the base module's deployment trigger hash: a flat
  // list (proxy/router integration) or a concat(...) of per-operation lists.
  const deploymentTriggers = (form: 'flat' | 'concat') =>
    form === 'flat'
      ? [
          '  triggers = {',
          '    redeployment = sha1(jsonencode([',
          '      aws_api_gateway_resource.proxy_resource.id,',
          '      aws_api_gateway_method.proxy_method.id,',
          '      aws_api_gateway_integration.lambda_integration.id,',
          '      aws_api_gateway_method.options_method.id,',
          '      aws_api_gateway_integration.options_integration.id,',
          '    ]))',
          '  }',
        ]
      : [
          '  triggers = {',
          '    redeployment = sha1(jsonencode(concat(',
          '      [for r in aws_api_gateway_resource.path_depth_0 : r.id],',
          '      [for m in aws_api_gateway_method.operation_methods : m.id],',
          '      [for i in aws_api_gateway_integration.lambda_integration : i.id],',
          '      [for m in aws_api_gateway_method.options_method : m.id],',
          '      [for i in aws_api_gateway_integration.options_integration : i.id],',
          '    )))',
          '  }',
        ];

  const setupTerraformApiModule = (
    apiNameKebabCase = 'api',
    deploymentForm: 'flat' | 'concat' = 'flat',
  ) => {
    tree.write(
      `packages/common/terraform/src/app/apis/${apiNameKebabCase}/${apiNameKebabCase}.tf`,
      [
        'module "rest_api" {',
        '  source = "../../../core/api/rest-api"',
        '}',
        '',
        'resource "aws_iam_role" "lambda_execution_role" {',
        '  name = "ApiHandler-execution-role-${random_string.suffix.result}"',
        '}',
        '',
        'resource "aws_api_gateway_deployment" "api_deployment" {',
        '  rest_api_id = module.rest_api.api_id',
        '',
        ...deploymentTriggers(deploymentForm),
        '',
        '  depends_on = [',
        '    aws_api_gateway_method.proxy_method,',
        '    aws_api_gateway_integration.lambda_integration,',
        '    aws_api_gateway_method.options_method,',
        '    aws_api_gateway_integration.options_integration,',
        '    aws_api_gateway_method_response.options_response,',
        '    aws_api_gateway_integration_response.options_integration_response,',
        '  ]',
        '}',
        '',
      ].join('\n'),
    );
  };

  const setupTerraformHarnessModule = (harnessNameKebabCase = 'my-harness') => {
    tree.write(
      `packages/common/terraform/src/app/harnesses/${harnessNameKebabCase}/${harnessNameKebabCase}.tf`,
      [
        'output "harness_arn" {',
        '  value = "arn:aws:bedrock-agentcore:us-east-1:111111111111:harness/my-harness"',
        '}',
        '',
        'output "memory_arn" {',
        '  value = null',
        '}',
        '',
      ].join('\n'),
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
    expect(tree.exists('packages/api/src/agui/converse-to-agui.ts')).toBe(true);
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

  it('generates the same actor-scoping session helper regardless of the api auth mode', async () => {
    // actorIdFromEvent (session.ts) reads whichever identity the API's own
    // authorizer already validated (Cognito claims or IAM principal ARN) at
    // runtime, so the generated file is identical whether the api project is
    // configured with auth: 'iam' or auth: 'cognito' — no template branch.
    setupTrpcApi('api', { auth: 'cognito' });
    setupHarness();
    setupApiConstruct();
    setupHarnessConstruct();

    await trpcAgentCoreHarnessConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'harness',
    });

    const sessionTs = tree.read('packages/api/src/agui/session.ts', 'utf-8')!;
    expect(sessionTs).toContain('actorIdFromEvent');
    expect(sessionTs).toContain('authorizer');
    expect(sessionTs).toContain('claims');
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
    expect(router).toContain(
      "import { history } from './procedures/history.js';",
    );
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

    expect(tree.read('packages/api/src/agui/handler.ts', 'utf-8')?.trim()).toBe(
      '// custom content',
    );
  });

  it('adds an addAguiRoute method to the api CDK construct, streaming over a regional REST route for iam auth', async () => {
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
    expect(construct).toContain('harness.grantInvokeAccess(aguiHandler)');
    // All auth modes stream '/agui' over the same API Gateway REST route
    // (ResponseTransferMode.STREAM) the Function URL special-case is retired
    // in favour of, forced onto a regional endpoint so the stream isn't
    // capped by an edge-optimized endpoint's CloudFront 30s idle timeout.
    expect(construct).toContain("this.api.root.addResource('agui')");
    expect(construct).toContain('ResponseTransferMode.STREAM');
    expect(construct).toContain(
      'endpointConfiguration: { types: [EndpointType.REGIONAL] },',
    );
    expect(construct).not.toContain('FunctionUrl');
    expect(construct).not.toContain('InvokeMode');
    expect(construct).not.toContain('aws4fetch');
    // Bundled with rolldown ahead of synth, not CDK's NodejsFunction.
    expect(construct).not.toContain('NodejsFunction');
    expect(construct).toContain('Code.fromAsset(');
    expect(construct).toContain('dist/packages/api/bundle/agui');
    // The construct must import every name it now references, or it won't
    // compile — the usages above can be present while the imports are silently
    // dropped.
    expect(construct).toMatch(
      /import\s*\{[^}]*\bEndpointType\b[^}]*\}\s*from\s*'aws-cdk-lib\/aws-apigateway'/,
    );
    expect(construct).toMatch(
      /import\s*\{[^}]*\bGrant\b[^}]*\}\s*from\s*'aws-cdk-lib\/aws-iam'/,
    );
    expect(construct).toMatch(
      /import\s*\{[^}]*\bMyHarness\b[^}]*\}\s*from\s*'\.\.\/harnesses\//,
    );
    expect(construct).toMatchSnapshot('api-construct.ts');
  });

  it('adds the same regional API Gateway route for non-iam auth', async () => {
    setupTrpcApi('api', { auth: 'cognito' });
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
    expect(construct).toContain('ResponseTransferMode.STREAM');
    expect(construct).toContain(
      'endpointConfiguration: { types: [EndpointType.REGIONAL] },',
    );
    expect(construct).not.toContain('FunctionUrl');
  });

  it('adds a bundle target to the api project for the agui handler', async () => {
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
    expect(config.targets?.bundle).toBeDefined();
    const rolldownConfig = tree.read(
      'packages/api/rolldown.config.ts',
      'utf-8',
    );
    expect(rolldownConfig).toContain("input: 'src/agui/handler.ts'");
    expect(rolldownConfig).toContain('bundle/agui');
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

  it('wires the /agui route into the api terraform module', async () => {
    setupTrpcApi('api', { iac: 'terraform', auth: 'cognito' });
    setupHarness('harness', { iac: 'terraform' });
    setupTerraformApiModule();
    setupTerraformHarnessModule();

    await trpcAgentCoreHarnessConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'harness',
    });

    expect(tree.exists('packages/api/src/agui/handler.ts')).toBe(true);
    // Terraform doesn't get the CDK construct patch.
    expect(tree.exists('packages/common/constructs/src/app/apis/api.ts')).toBe(
      false,
    );

    const module = tree.read(
      'packages/common/terraform/src/app/apis/api/api.tf',
      'utf-8',
    )!;
    expect(module).toContain('variable "agui_harness_arn"');
    expect(module).toContain('variable "agui_harness_memory_arn"');
    expect(module).toContain('resource "aws_lambda_function" "agui_handler"');
    expect(module).toContain('resource "aws_api_gateway_resource" "agui"');
    expect(module).toContain('response_transfer_mode  = "STREAM"');
    expect(module).toContain('authorization = "COGNITO_USER_POOLS"');
    expect(module).toContain(
      'authorizer_id = aws_api_gateway_authorizer.cognito_authorizer.id',
    );
    expect(module).toContain('bundle/agui');
    expect(module).toContain(
      'resource "aws_iam_role_policy" "agui_memory_read"',
    );
    // The memory-read grant must not gate count/for_each on the memory ARN: it
    // is only known once the Harness's Memory is provisioned, and a
    // count/for_each over an apply-time value fails `terraform plan`. The grant
    // is unconditional, mirroring the CDK construct.
    expect(module).not.toContain('var.agui_harness_memory_arn != null');

    // The /agui route must be wired into the existing API Gateway deployment,
    // otherwise a fresh apply creates the route but never redeploys the stage
    // to serve it. Both the redeployment trigger hash and depends_on reference
    // the appended method + integration.
    const deployment = module.slice(
      module.indexOf(
        'resource "aws_api_gateway_deployment" "api_deployment" {',
      ),
      module.indexOf('variable "agui_harness_arn"'),
    );
    expect(deployment).toContain('aws_api_gateway_method.agui.id');
    expect(deployment).toContain('aws_api_gateway_integration.agui.id');
    expect(deployment).toContain('aws_api_gateway_method.agui,');
    expect(deployment).toContain('aws_api_gateway_integration.agui,');
  });

  it('wires the /agui route into a concat-form api deployment trigger', async () => {
    setupTrpcApi('api', { iac: 'terraform' });
    setupHarness('harness', { iac: 'terraform' });
    setupTerraformApiModule('api', 'concat');
    setupTerraformHarnessModule();

    await trpcAgentCoreHarnessConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'harness',
    });

    const module = tree.read(
      'packages/common/terraform/src/app/apis/api/api.tf',
      'utf-8',
    )!;
    const deployment = module.slice(
      module.indexOf(
        'resource "aws_api_gateway_deployment" "api_deployment" {',
      ),
      module.indexOf('variable "agui_harness_arn"'),
    );
    // In concat(...) form each trigger element is a list.
    expect(deployment).toContain('[aws_api_gateway_method.agui.id]');
    expect(deployment).toContain('[aws_api_gateway_integration.agui.id]');
    expect(deployment).toContain('aws_api_gateway_method.agui,');
    expect(deployment).toContain('aws_api_gateway_integration.agui,');
  });

  it('is idempotent when re-run against a terraform api', async () => {
    setupTrpcApi('api', { iac: 'terraform' });
    setupHarness('harness', { iac: 'terraform' });
    setupTerraformApiModule();
    setupTerraformHarnessModule();

    const run = () =>
      trpcAgentCoreHarnessConnectionGenerator(tree, {
        sourceProject: 'api',
        targetProject: 'harness',
      });

    await run();
    const moduleAfterFirst = tree.read(
      'packages/common/terraform/src/app/apis/api/api.tf',
      'utf-8',
    );

    await run();

    expect(
      tree.read('packages/common/terraform/src/app/apis/api/api.tf', 'utf-8'),
    ).toEqual(moduleAfterFirst);
  });

  it('warns and skips the terraform infra patch when the harness has no generated module', async () => {
    setupTrpcApi('api', { iac: 'terraform' });
    setupHarness('harness', { iac: undefined });
    setupTerraformApiModule();
    // No harness module generated (infra: 'none' on the harness).

    await trpcAgentCoreHarnessConnectionGenerator(tree, {
      sourceProject: 'api',
      targetProject: 'harness',
    });

    const module = tree.read(
      'packages/common/terraform/src/app/apis/api/api.tf',
      'utf-8',
    )!;
    expect(module).not.toContain('agui_harness_arn');
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
