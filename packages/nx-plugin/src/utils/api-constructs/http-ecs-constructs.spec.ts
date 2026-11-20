/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Tree, updateJson } from '@nx/devkit';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tsTrpcApiGenerator } from '../../trpc/backend/generator.js';
import type { TsTrpcApiGeneratorSchema } from '../../trpc/backend/schema';
import { createTreeUsingTsSolutionSetup } from '../test.js';

const CONSTRUCTS_SRC = 'packages/common/constructs/src';

// Temp files sit next to this spec so `aws-cdk-lib` and `constructs` resolve
// from the workspace root `node_modules`; `_tmp_*` is git-ignored.
const TMP_DIR = join(import.meta.dirname, `_tmp_http-ecs-${process.pid}`);

/** Stands in for the API project the generated construct imports its router from. */
const ROUTER_STUB = `export const appRouter = {
  _def: {
    procedures: {
      echo: { _def: { type: 'query' } },
      save: { _def: { type: 'mutation' } },
    },
  },
};
`;

const generatorOptions = (
  auth: TsTrpcApiGeneratorSchema['auth'],
): TsTrpcApiGeneratorSchema => ({
  name: 'TestApi',
  directory: 'apps',
  infra: 'http-ecs',
  integrationPattern: 'shared',
  auth,
  iac: 'cdk',
});

const readOrThrow = (tree: Tree, path: string): string => {
  const content = tree.read(path, 'utf-8');
  if (content === null) {
    throw new Error(`Not rendered: ${path}`);
  }
  return content;
};

interface ApiModuleShape {
  readonly TestApi: {
    new (
      scope: import('constructs').Construct,
      id: string,
      props: Record<string, unknown>,
    ): unknown;
    defaultIntegrations: (
      scope: import('constructs').Construct,
      props: Record<string, unknown>,
    ) => { build: () => Record<string, unknown> };
  };
}

interface CfnResourceJson {
  readonly Type: string;
  readonly Properties: Record<string, any>;
}

/**
 * Transpiles the constructs the generator vended into ES modules under
 * `moduleDir`, pointing every relative import at its sibling there and the
 * API project's router at a stub. The templates are not real `.ts` files, so
 * they cannot be imported directly.
 */
const transpileConstructs = (
  tree: Tree,
  moduleDir: string,
  paths: string[],
): void => {
  mkdirSync(moduleDir, { recursive: true });
  const modulePath = (name: string) => join(moduleDir, `${name}.mjs`);
  writeFileSync(modulePath('router-stub'), ROUTER_STUB);

  for (const path of paths) {
    const name = path.split('/').pop()!.replace(/\.ts$/, '');
    const transpiled = ts.transpileModule(
      readOrThrow(tree, `${CONSTRUCTS_SRC}/${path}`),
      {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    writeFileSync(
      modulePath(name),
      transpiled
        // Every vended core file has a unique basename, so resolving a
        // relative import by its basename alone is unambiguous.
        .replace(
          /(["'])(?:\.{1,2}\/)+(?:[\w-]+\/)*([\w-]+)\.js\1/g,
          (_match, _quote, mod) =>
            JSON.stringify(pathToFileURL(modulePath(mod)).href),
        )
        .replace(
          /(["'])@proj\/test-api\1/g,
          JSON.stringify(pathToFileURL(modulePath('router-stub')).href),
        )
        // The modules are written side by side rather than at the paths the
        // generator vends, so `import.meta.url` is pinned to the module's own
        // file. Asset paths resolved from it are relative to the fake
        // workspace root `moduleDir` sits six levels below.
        .replace(
          /import\.meta\.url/g,
          JSON.stringify(pathToFileURL(modulePath(name)).href),
        ),
    );
  }
};

describe('vended http-ecs constructs compile', () => {
  const COMPILE_DIR = join(TMP_DIR, 'compile');

  /** Stands in for the API project's types as well as its router. */
  const ROUTER_STUB_TS = `import { initTRPC } from '@trpc/server';

const t = initTRPC.create();
export const appRouter = t.router({
  echo: t.procedure.query(() => ({ result: '' })),
});
export type AppRouter = typeof appRouter;
`;

  afterAll(() => {
    rmSync(COMPILE_DIR, { recursive: true, force: true });
  });

  const compile = async (
    auth: TsTrpcApiGeneratorSchema['auth'],
    format: 'esm' | 'cjs',
  ): Promise<string[]> => {
    const tree = createTreeUsingTsSolutionSetup();
    if (format === 'cjs') {
      updateJson(tree, 'package.json', (json) => ({
        ...json,
        type: 'commonjs',
      }));
    }
    await tsTrpcApiGenerator(tree, generatorOptions(auth));

    const dir = join(COMPILE_DIR, `${auth}-${format}`);
    const srcDir = join(dir, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ type: format === 'esm' ? 'module' : 'commonjs' }),
    );
    writeFileSync(join(srcDir, 'router-stub.ts'), ROUTER_STUB_TS);

    const rootNames: string[] = [];
    const walk = (treePath: string): string[] =>
      tree.isFile(treePath)
        ? [treePath]
        : tree.children(treePath).flatMap((c) => walk(`${treePath}/${c}`));
    for (const treePath of walk(CONSTRUCTS_SRC)) {
      const target = join(srcDir, treePath.slice(CONSTRUCTS_SRC.length + 1));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readOrThrow(tree, treePath));
      rootNames.push(target);
    }

    const program = ts.createProgram(rootNames, {
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      types: ['node'],
      paths: { '@proj/test-api': [join(srcDir, 'router-stub.ts')] },
    });
    return ts
      .getPreEmitDiagnostics(program)
      .map(
        (d) =>
          `${d.file?.fileName ?? ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
      );
  };

  it.each<[TsTrpcApiGeneratorSchema['auth'], 'esm' | 'cjs']>([
    ['iam', 'esm'],
    ['cognito', 'esm'],
    ['custom', 'esm'],
    ['iam', 'cjs'],
  ])(
    'should type check with %s auth as %s',
    async (auth, format) => {
      expect(await compile(auth, format)).toEqual([]);
    },
    180_000,
  );
});

describe('http-ecs API construct synth', () => {
  const MODULE_DIR = join(TMP_DIR, 'modules');
  const IMAGE_DIR = join(TMP_DIR, 'image');
  let cdkLib: typeof import('aws-cdk-lib');
  let ec2: typeof import('aws-cdk-lib/aws-ec2');
  let assertions: typeof import('aws-cdk-lib/assertions');
  let appCount = 0;

  const renderTree = async (
    auth: TsTrpcApiGeneratorSchema['auth'],
  ): Promise<Tree> => {
    const tree = createTreeUsingTsSolutionSetup();
    await tsTrpcApiGenerator(tree, generatorOptions(auth));
    return tree;
  };

  const loadApi = async (
    auth: TsTrpcApiGeneratorSchema['auth'],
  ): Promise<ApiModuleShape> => {
    const tree = await renderTree(auth);
    // The same depth below a workspace root as the real construct, so the
    // relative Lambda asset path it resolves lands inside the temp root below.
    const fakeRoot = join(MODULE_DIR, auth);
    const moduleDir = join(fakeRoot, 'packages/common/constructs/src/app/apis');
    mkdirSync(join(fakeRoot, 'dist/apps/test-api/bundle/authorizer'), {
      recursive: true,
    });
    writeFileSync(
      join(fakeRoot, 'dist/apps/test-api/bundle/authorizer/index.js'),
      '',
    );
    transpileConstructs(tree, moduleDir, [
      'core/checkov.ts',
      'core/cloudfront.ts',
      'core/runtime-config.ts',
      'core/workspace.ts',
      'core/api/utils.ts',
      'core/api/http-api.ts',
      'core/api/ecs-http-endpoint.ts',
      'core/api/trpc-utils.ts',
      'core/container/ecs-service.ts',
      'app/services/test-api-container.ts',
      'app/apis/test-api.ts',
    ]);
    return await import(pathToFileURL(join(moduleDir, 'test-api.mjs')).href);
  };

  beforeAll(async () => {
    mkdirSync(IMAGE_DIR, { recursive: true });
    writeFileSync(join(IMAGE_DIR, 'Dockerfile'), 'FROM scratch\n');
    cdkLib = await import('aws-cdk-lib');
    ec2 = await import('aws-cdk-lib/aws-ec2');
    assertions = await import('aws-cdk-lib/assertions');
  }, 120_000);

  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  /**
   * Deploys the API the way its guide tells users to: one VPC, and the
   * construct building its own backend from the default integrations.
   */
  const synthApi = (
    api: ApiModuleShape,
    props: Record<string, unknown> = {},
  ) => {
    const app = new cdkLib.App({
      outdir: join(TMP_DIR, `cdk.out-${appCount++}`),
    });
    const stack = new cdkLib.Stack(app, 'Test');
    const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
    const integrations = api.TestApi.defaultIntegrations(stack, {
      vpc,
      service: { image: { directory: IMAGE_DIR } },
    }).build();
    new api.TestApi(stack, 'TestApi', { integrations, ...props });

    const template = assertions.Template.fromStack(stack);
    const resources = template.toJSON().Resources as Record<
      string,
      CfnResourceJson
    >;
    const ofType = (type: string) =>
      Object.entries(resources).filter(([, r]) => r.Type === type);
    return { template, resources, ofType, stack };
  };

  describe('iam auth', () => {
    let out: ReturnType<typeof synthApi>;

    beforeAll(async () => {
      out = synthApi(await loadApi('iam'));
    }, 180_000);

    it('should put the load balancer inside the VPC, not on the internet', () => {
      const [[, loadBalancer]] = out.ofType(
        'AWS::ElasticLoadBalancingV2::LoadBalancer',
      );
      expect(loadBalancer.Properties.Scheme).toBe('internal');
      expect(loadBalancer.Properties.Type ?? 'application').toBe('application');
    });

    it('should let only the VPC link reach the load balancer', () => {
      const [[albSecurityGroupId, albSecurityGroup]] = Object.entries(
        out.resources,
      ).filter(
        ([id, r]) =>
          r.Type === 'AWS::EC2::SecurityGroup' &&
          id.includes('TestApiBackendEndpointLoadBalancer'),
      );
      const vpcLinkSecurityGroupId = Object.keys(out.resources).find(
        (id) =>
          out.resources[id].Type === 'AWS::EC2::SecurityGroup' &&
          id.includes('VpcLinkSecurityGroup'),
      );
      expect(vpcLinkSecurityGroupId).toBeDefined();

      const ingress = [
        ...(albSecurityGroup.Properties.SecurityGroupIngress ?? []),
        ...Object.values(out.resources)
          .filter(
            (r) =>
              r.Type === 'AWS::EC2::SecurityGroupIngress' &&
              r.Properties.GroupId?.['Fn::GetAtt']?.[0] === albSecurityGroupId,
          )
          .map((r) => r.Properties),
      ];
      expect(ingress).toHaveLength(1);
      expect(ingress[0].FromPort).toBe(80);
      expect(ingress[0].ToPort).toBe(80);
      expect(
        ingress[0].SourceSecurityGroupId?.['Fn::GetAtt']?.[0] ??
          ingress[0].SourceSecurityGroupId,
      ).toBe(vpcLinkSecurityGroupId);
      // No address range anywhere on the way in.
      expect(JSON.stringify(ingress)).not.toContain('0.0.0.0/0');
    });

    it('should give the tasks exactly one inbound rule, from the load balancer', () => {
      const serviceSecurityGroupId = Object.keys(out.resources).find(
        (id) =>
          out.resources[id].Type === 'AWS::EC2::SecurityGroup' &&
          id.includes('ServiceServiceSecurityGroup'),
      );
      expect(serviceSecurityGroupId).toBeDefined();

      const serviceSecurityGroup =
        out.resources[serviceSecurityGroupId!].Properties;
      expect(serviceSecurityGroup.SecurityGroupIngress ?? []).toEqual([]);

      const ingress = Object.values(out.resources).filter(
        (r) =>
          r.Type === 'AWS::EC2::SecurityGroupIngress' &&
          r.Properties.GroupId?.['Fn::GetAtt']?.[0] === serviceSecurityGroupId,
      );
      expect(ingress).toHaveLength(1);
      expect(ingress[0].Properties.FromPort).toBe(8080);
      expect(ingress[0].Properties.ToPort).toBe(8080);
      expect(
        ingress[0].Properties.SourceSecurityGroupId['Fn::GetAtt'][0],
      ).toEqual(
        expect.stringContaining(
          'TestApiBackendEndpointLoadBalancerSecurityGroup',
        ),
      );
    });

    it('should define the load balancer in the shared core construct', () => {
      const [[loadBalancerId]] = out.ofType(
        'AWS::ElasticLoadBalancingV2::LoadBalancer',
      );
      // The construct path proves the resource comes from the shared
      // EcsHttpEndpoint, not from the API's own construct.
      expect(loadBalancerId).toContain('TestApiBackendEndpoint');
    });

    it('should drop invalid headers at the load balancer', () => {
      const [[, loadBalancer]] = out.ofType(
        'AWS::ElasticLoadBalancingV2::LoadBalancer',
      );
      expect(loadBalancer.Properties.LoadBalancerAttributes).toEqual(
        expect.arrayContaining([
          {
            Key: 'routing.http.drop_invalid_header_fields.enabled',
            Value: 'true',
          },
        ]),
      );
    });

    it('should explain every checkov rule it skips', () => {
      const skipped = Object.values(out.resources)
        .flatMap(
          (r) =>
            ((r as unknown as { Metadata?: { checkov?: { skip?: unknown[] } } })
              .Metadata?.checkov?.skip ?? []) as {
              id: string;
              comment: string;
            }[],
        )
        // The access log group's skips come from the core HTTP API construct.
        .filter(
          (skip) => skip.id !== 'CKV_AWS_66' && skip.id !== 'CKV_AWS_338',
        );
      // Exactly the rules checkov 3.4.5 raises for this design: HTTPS and TLS
      // 1.2 on a listener that TLS never reaches, and access logging and
      // versioning on the load balancer's own access log bucket. CKV_AWS_91 is
      // no longer among them: the load balancer's access logs are on.
      expect(skipped.map((skip) => skip.id).sort()).toEqual([
        'CKV_AWS_103',
        'CKV_AWS_18',
        'CKV_AWS_2',
        'CKV_AWS_21',
      ]);
      for (const skip of skipped) {
        expect(skip.comment).not.toBe('');
      }
    });

    it('should write the load balancer access logs to its own bucket', () => {
      const [[, loadBalancer]] = out.ofType(
        'AWS::ElasticLoadBalancingV2::LoadBalancer',
      );
      const attributes = loadBalancer.Properties.LoadBalancerAttributes as {
        Key: string;
        Value: unknown;
      }[];
      const attribute = (key: string) =>
        attributes.find((a) => a.Key === key)?.Value;
      expect(attribute('access_logs.s3.enabled')).toBe('true');

      const [[bucketId, bucket]] = Object.entries(out.resources).filter(
        ([id, r]) => r.Type === 'AWS::S3::Bucket' && id.includes('AccessLogs'),
      );
      expect(attribute('access_logs.s3.bucket')).toEqual({ Ref: bucketId });

      // A load balancer can only deliver access logs to an SSE-S3 bucket, and
      // CDK's own `logAccessLogs` refuses a bucket with a KMS key.
      expect(
        bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration,
      ).toEqual([
        { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
      ]);
      expect(bucket.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
      // The destroy path: the e2e leftover check fails on a bucket a destroy
      // leaves behind.
      expect(out.resources[bucketId].DeletionPolicy ?? 'Delete').toBe('Delete');
    });

    it('should let the VPC link reach nothing but the load balancer', () => {
      const vpcLinkSecurityGroupId = Object.keys(out.resources).find(
        (id) =>
          out.resources[id].Type === 'AWS::EC2::SecurityGroup' &&
          id.includes('VpcLinkSecurityGroup'),
      )!;
      const albSecurityGroupId = Object.keys(out.resources).find(
        (id) =>
          out.resources[id].Type === 'AWS::EC2::SecurityGroup' &&
          id.includes('TestApiBackendEndpointLoadBalancer'),
      )!;

      const egress = [
        ...(out.resources[vpcLinkSecurityGroupId].Properties
          .SecurityGroupEgress ?? []),
        ...Object.values(out.resources)
          .filter(
            (r) =>
              r.Type === 'AWS::EC2::SecurityGroupEgress' &&
              r.Properties.GroupId?.['Fn::GetAtt']?.[0] ===
                vpcLinkSecurityGroupId,
          )
          .map((r) => r.Properties),
      ];
      // One rule: the load balancer's listener port on the load balancer's own
      // security group. No `allowAllOutbound`, so no address range either.
      expect(egress).toHaveLength(1);
      expect(egress[0].FromPort).toBe(80);
      expect(egress[0].ToPort).toBe(80);
      expect(
        egress[0].DestinationSecurityGroupId?.['Fn::GetAtt']?.[0] ??
          egress[0].DestinationSecurityGroupId,
      ).toBe(albSecurityGroupId);
      expect(JSON.stringify(egress)).not.toContain('0.0.0.0/0');
    });

    it('should never allow an address range inbound', () => {
      const ingressRules = [
        ...Object.values(out.resources)
          .filter((r) => r.Type === 'AWS::EC2::SecurityGroupIngress')
          .map((r) => r.Properties),
        ...out
          .ofType('AWS::EC2::SecurityGroup')
          .flatMap(([, r]) => r.Properties.SecurityGroupIngress ?? []),
      ];
      expect(
        ingressRules.filter((rule) => rule.CidrIp || rule.CidrIpv6),
      ).toEqual([]);
    });

    it('should health check the container over the load balancer', () => {
      const [[, targetGroup]] = out.ofType(
        'AWS::ElasticLoadBalancingV2::TargetGroup',
      );
      expect(targetGroup.Properties.TargetType).toBe('ip');
      expect(targetGroup.Properties.Port).toBe(8080);
      expect(targetGroup.Properties.HealthCheckPath).toBe('/health');
      expect(targetGroup.Properties.Matcher).toEqual({ HttpCode: '200' });
    });

    it('should give the service time to start before health checks count', () => {
      const [[, service]] = out.ofType('AWS::ECS::Service');
      expect(service.Properties.HealthCheckGracePeriodSeconds).toBe(120);
      expect(
        service.Properties.NetworkConfiguration.AwsvpcConfiguration
          .AssignPublicIp,
      ).toBe('DISABLED');
    });

    it('should reach the service through a VPC link integration', () => {
      const [[, vpcLink]] = out.ofType('AWS::ApiGatewayV2::VpcLink');
      expect(vpcLink.Properties.SecurityGroupIds).toHaveLength(1);

      const integrations = out.ofType('AWS::ApiGatewayV2::Integration');
      expect(integrations).toHaveLength(1);
      const [[, integration]] = integrations;
      expect(integration.Properties.IntegrationType).toBe('HTTP_PROXY');
      expect(integration.Properties.ConnectionType).toBe('VPC_LINK');
      expect(integration.Properties.ConnectionId).toBeDefined();
    });

    it('should authorize every route with the API authorizer', () => {
      const routes = out.ofType('AWS::ApiGatewayV2::Route');
      // One route per tRPC procedure in the stub router.
      expect(routes).toHaveLength(2);
      for (const [, route] of routes) {
        expect(route.Properties.AuthorizationType).toBe('AWS_IAM');
      }
      // Every route resolves to the one load-balancer integration.
      const targets = new Set(
        routes.map(([, r]) => JSON.stringify(r.Properties.Target)),
      );
      expect(targets.size).toBe(1);
    });
  });

  describe.each<[TsTrpcApiGeneratorSchema['auth'], string]>([
    ['cognito', 'JWT'],
    ['custom', 'CUSTOM'],
  ])('%s auth', (auth, authorizationType) => {
    let out: ReturnType<typeof synthApi>;

    beforeAll(async () => {
      const api = await loadApi(auth);
      const app = new cdkLib.App({
        outdir: join(TMP_DIR, `cdk.out-${appCount++}`),
      });
      const stack = new cdkLib.Stack(app, 'Test');
      const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
      const cognito = await import('aws-cdk-lib/aws-cognito');
      const integrations = api.TestApi.defaultIntegrations(stack, {
        vpc,
        service: { image: { directory: IMAGE_DIR } },
      }).build();
      const identity =
        auth === 'cognito'
          ? (() => {
              const userPool = new cognito.UserPool(stack, 'UserPool');
              return {
                userPool,
                userPoolClient: userPool.addClient('Client'),
              };
            })()
          : undefined;
      new api.TestApi(stack, 'TestApi', {
        integrations,
        ...(identity ? { identity } : {}),
      });
      const template = assertions.Template.fromStack(stack);
      const resources = template.toJSON().Resources as Record<
        string,
        CfnResourceJson
      >;
      out = {
        template,
        resources,
        ofType: (type: string) =>
          Object.entries(resources).filter(([, r]) => r.Type === type),
        stack,
      };
    }, 180_000);

    it('should authorize every route', () => {
      const routes = out.ofType('AWS::ApiGatewayV2::Route');
      expect(routes).toHaveLength(2);
      for (const [, route] of routes) {
        expect(route.Properties.AuthorizationType).toBe(authorizationType);
        expect(route.Properties.AuthorizerId).toBeDefined();
      }
      expect(out.ofType('AWS::ApiGatewayV2::Authorizer')).toHaveLength(1);
    });

    it('should keep the load balancer internal', () => {
      const [[, loadBalancer]] = out.ofType(
        'AWS::ElasticLoadBalancingV2::LoadBalancer',
      );
      expect(loadBalancer.Properties.Scheme).toBe('internal');
    });
  });
});
