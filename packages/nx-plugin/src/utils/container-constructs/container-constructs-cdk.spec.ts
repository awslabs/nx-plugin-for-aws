/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Tree, updateJson } from '@nx/devkit';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { declareDependencies } from '../declared-dependencies.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../shared-constructs.js';
import { createTreeUsingTsSolutionSetup } from '../test.js';
import type {
  AddContainerServiceInfraOptions,
  ContainerAuth,
  ContainerIngress,
} from './container-constructs.js';
import { addContainerServiceCdkConstructs } from './container-constructs-cdk.js';

const sharedConstructsDeclaration = declareDependencies()({
  ts: [...SHARED_CONSTRUCTS_DEPENDENCIES],
});

const CONSTRUCTS_SRC = 'packages/common/constructs/src';

// Temp files sit next to this spec so `aws-cdk-lib` and `constructs` resolve
// from the workspace root `node_modules`; `_tmp_*` is git-ignored.
const TMP_DIR = join(
  import.meta.dirname,
  `_tmp_container-constructs-${process.pid}`,
);

const serviceOptions = (
  overrides: Partial<AddContainerServiceInfraOptions> = {},
): AddContainerServiceInfraOptions => ({
  nameClassName: 'Orders',
  nameKebabCase: 'orders',
  projectName: '@proj/shop',
  dockerImageTag: 'proj-orders:latest',
  dockerBuildContextDir: 'dist/apps/shop/bundle/container/orders',
  containerPort: 8080,
  ingress: 'http-api',
  auth: 'iam',
  containers: 'docker',
  ...overrides,
});

const renderTree = async (
  options: AddContainerServiceInfraOptions,
  { commonjs = false }: { commonjs?: boolean } = {},
): Promise<Tree> => {
  const tree = createTreeUsingTsSolutionSetup();
  if (commonjs) {
    updateJson(tree, 'package.json', (json) => ({ ...json, type: 'commonjs' }));
  }
  await sharedConstructsGenerator(
    tree,
    { iac: 'cdk' },
    sharedConstructsDeclaration,
  );
  await addContainerServiceCdkConstructs(tree, options);
  return tree;
};

const readOrThrow = (tree: Tree, path: string): string => {
  const content = tree.read(path, 'utf-8');
  if (content === null) {
    throw new Error(`Not rendered: ${path}`);
  }
  return content;
};

const listFiles = (tree: Tree, dir: string): string[] =>
  tree.isFile(dir)
    ? [dir]
    : tree.children(dir).flatMap((child) => listFiles(tree, `${dir}/${child}`));

const fileContents = (tree: Tree, dir: string): Record<string, string> =>
  Object.fromEntries(
    listFiles(tree, dir).map((path) => [path, readOrThrow(tree, path)]),
  );

describe('addContainerServiceCdkConstructs', () => {
  it('should vend the core construct and the service subclass', async () => {
    const tree = await renderTree(serviceOptions());

    expect(tree.exists(`${CONSTRUCTS_SRC}/core/container/ecs-service.ts`)).toBe(
      true,
    );
    expect(tree.exists(`${CONSTRUCTS_SRC}/app/services/orders.ts`)).toBe(true);
    expect(readOrThrow(tree, `${CONSTRUCTS_SRC}/core/index.ts`)).toContain(
      "export * from './container/ecs-service.js';",
    );
    expect(
      readOrThrow(tree, `${CONSTRUCTS_SRC}/app/services/index.ts`),
    ).toContain("export * from './orders.js';");
    expect(readOrThrow(tree, `${CONSTRUCTS_SRC}/app/index.ts`)).toContain(
      "export * from './services/index.js';",
    );
  });

  it('should change nothing when run again', async () => {
    const tree = await renderTree(serviceOptions());
    const before = fileContents(tree, CONSTRUCTS_SRC);

    await addContainerServiceCdkConstructs(tree, serviceOptions());

    expect(fileContents(tree, CONSTRUCTS_SRC)).toEqual(before);
  });

  it('should keep a user edit to the service file on re-run', async () => {
    const tree = await renderTree(serviceOptions());
    const servicePath = `${CONSTRUCTS_SRC}/app/services/orders.ts`;
    tree.write(servicePath, '// edited by the user\n');

    await addContainerServiceCdkConstructs(tree, serviceOptions());

    expect(readOrThrow(tree, servicePath)).toBe('// edited by the user\n');
  });

  it.each<[string, ContainerIngress, ContainerAuth]>([
    ['http-api iam', 'http-api', 'iam'],
    ['http-api cognito', 'http-api', 'cognito'],
    ['http-api none', 'http-api', 'none'],
    ['private', 'private', 'none'],
  ])(
    'should match the vended files snapshot (%s)',
    async (_, ingress, auth) => {
      const tree = await renderTree(serviceOptions({ ingress, auth }));

      expect(
        readOrThrow(tree, `${CONSTRUCTS_SRC}/core/container/ecs-service.ts`),
      ).toMatchSnapshot('ecs-service.ts');
      expect(
        readOrThrow(tree, `${CONSTRUCTS_SRC}/app/services/orders.ts`),
      ).toMatchSnapshot('orders.ts');
    },
  );

  it('should alias the core imports when the service name shadows them', async () => {
    const tree = await renderTree(
      serviceOptions({
        nameClassName: 'EcsService',
        nameKebabCase: 'ecs-service',
      }),
    );

    const content = readOrThrow(
      tree,
      `${CONSTRUCTS_SRC}/app/services/ecs-service.ts`,
    );
    expect(content).toContain('EcsService as CoreEcsService');
    expect(content).toContain('export class EcsService extends CoreEcsService');
  });
});

describe('vended container constructs compile', () => {
  const COMPILE_DIR = join(TMP_DIR, 'compile');

  afterAll(() => {
    rmSync(COMPILE_DIR, { recursive: true, force: true });
  });

  // One program per module format over every render keeps aws-cdk-lib's
  // declarations loaded once.
  const compile = async (format: 'esm' | 'cjs') => {
    const renders: [string, AddContainerServiceInfraOptions][] = [
      ['iam', serviceOptions()],
      ['cognito', serviceOptions({ auth: 'cognito' })],
      ['none', serviceOptions({ auth: 'none' })],
      ['private', serviceOptions({ ingress: 'private', auth: 'none' })],
    ];
    const formatDir = join(COMPILE_DIR, format);
    mkdirSync(formatDir, { recursive: true });
    writeFileSync(
      join(formatDir, 'package.json'),
      JSON.stringify({ type: format === 'esm' ? 'module' : 'commonjs' }),
    );
    const rootNames: string[] = [];
    for (const [name, options] of renders) {
      const tree = await renderTree(options, { commonjs: format === 'cjs' });
      for (const [path, content] of Object.entries(
        fileContents(tree, CONSTRUCTS_SRC),
      )) {
        const target = join(formatDir, name, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
        rootNames.push(target);
      }
    }
    const program = ts.createProgram(rootNames, {
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      types: ['node'],
    });
    return ts
      .getPreEmitDiagnostics(program)
      .map(
        (d) =>
          `${d.file?.fileName ?? ''}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
      );
  };

  it('should compile as ESM', async () => {
    expect(await compile('esm')).toEqual([]);
  }, 120_000);

  it('should compile as CommonJS', async () => {
    expect(await compile('cjs')).toEqual([]);
  }, 120_000);
});

// Narrow shapes of the transpiled modules: the templates are not real `.ts`
// files, so their types are not statically resolvable here.
interface EcsServiceInstance {
  readonly cluster: unknown;
  readonly service: unknown;
  readonly taskDefinition: unknown;
  readonly taskRole: import('aws-cdk-lib/aws-iam').IRole;
  readonly securityGroup: unknown;
  readonly connections: unknown;
  readonly loadBalancer?: unknown;
  readonly httpApi?: unknown;
  readonly url?: string;
  grantInvoke: (grantee: import('aws-cdk-lib/aws-iam').IGrantable) => unknown;
  restrictCorsTo: (...origins: string[]) => void;
}

interface EcsServiceModuleShape {
  readonly EcsService: new (
    scope: import('constructs').Construct,
    id: string,
    props: Record<string, unknown>,
  ) => EcsServiceInstance;
}

interface ServiceModuleShape {
  readonly Orders: new (
    scope: import('constructs').Construct,
    id: string,
    props: Record<string, unknown>,
  ) => EcsServiceInstance;
}

interface RuntimeConfigModuleShape {
  readonly RuntimeConfig: {
    ensure: (scope: import('constructs').Construct) => {
      get: (namespace: string) => Record<string, any>;
      readonly appConfigApplicationId: string;
    };
  };
}

interface CfnResourceJson {
  readonly Type: string;
  readonly Properties: Record<string, any>;
  readonly Metadata?: Record<string, any>;
}

describe('EcsService synth', () => {
  const MODULE_DIR = join(TMP_DIR, 'modules');
  const IMAGE_DIR = join(TMP_DIR, 'image');
  let cdkLib: typeof import('aws-cdk-lib');
  let ec2: typeof import('aws-cdk-lib/aws-ec2');
  let ecs: typeof import('aws-cdk-lib/aws-ecs');
  let iam: typeof import('aws-cdk-lib/aws-iam');
  let cognito: typeof import('aws-cdk-lib/aws-cognito');
  let secretsmanager: typeof import('aws-cdk-lib/aws-secretsmanager');
  let assertions: typeof import('aws-cdk-lib/assertions');
  let EcsServiceModule: EcsServiceModuleShape;
  let RuntimeConfigModule: RuntimeConfigModuleShape;
  let ServiceModule: ServiceModuleShape;
  let appCount = 0;

  beforeAll(async () => {
    const tree = await renderTree(serviceOptions());
    mkdirSync(MODULE_DIR, { recursive: true });
    const modulePath = (name: string) => join(MODULE_DIR, `${name}.mjs`);
    const transpile = (path: string) =>
      ts.transpileModule(readOrThrow(tree, `${CONSTRUCTS_SRC}/${path}`), {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText;
    writeFileSync(modulePath('checkov'), transpile('core/checkov.ts'));
    writeFileSync(
      modulePath('runtime-config'),
      transpile('core/runtime-config.ts'),
    );
    writeFileSync(
      modulePath('ecs-service'),
      transpile('core/container/ecs-service.ts')
        .split('../runtime-config.js')
        .join(pathToFileURL(modulePath('runtime-config')).href)
        .split('../checkov.js')
        .join(pathToFileURL(modulePath('checkov')).href),
    );
    writeFileSync(modulePath('workspace'), transpile('core/workspace.ts'));
    // The per-service subclass, with its core imports pointed at the
    // transpiled modules above.
    writeFileSync(
      modulePath('orders'),
      transpile('app/services/orders.ts')
        .split('../../core/container/ecs-service.js')
        .join(pathToFileURL(modulePath('ecs-service')).href)
        .split('../../core/runtime-config.js')
        .join(pathToFileURL(modulePath('runtime-config')).href)
        .split('../../core/workspace.js')
        .join(pathToFileURL(modulePath('workspace')).href),
    );
    mkdirSync(IMAGE_DIR, { recursive: true });
    writeFileSync(join(IMAGE_DIR, 'Dockerfile'), 'FROM scratch\n');

    cdkLib = await import('aws-cdk-lib');
    ec2 = await import('aws-cdk-lib/aws-ec2');
    ecs = await import('aws-cdk-lib/aws-ecs');
    iam = await import('aws-cdk-lib/aws-iam');
    cognito = await import('aws-cdk-lib/aws-cognito');
    secretsmanager = await import('aws-cdk-lib/aws-secretsmanager');
    assertions = await import('aws-cdk-lib/assertions');
    EcsServiceModule = await import(
      pathToFileURL(modulePath('ecs-service')).href
    );
    RuntimeConfigModule = await import(
      pathToFileURL(modulePath('runtime-config')).href
    );
    ServiceModule = await import(pathToFileURL(modulePath('orders')).href);
  });

  afterAll(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  const newStack = () => {
    const app = new cdkLib.App({
      outdir: join(TMP_DIR, `cdk.out-${appCount++}`),
    });
    const stack = new cdkLib.Stack(app, 'Test');
    const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
    return { app, stack, vpc };
  };

  const newService = (
    props: Record<string, unknown> = {},
    existing?: ReturnType<typeof newStack>,
  ) => {
    const env = existing ?? newStack();
    const service = new EcsServiceModule.EcsService(env.stack, 'Orders', {
      serviceName: 'Orders',
      vpc: env.vpc,
      image: { directory: IMAGE_DIR },
      ...props,
    });
    return { ...env, service };
  };

  const synth = (stack: import('aws-cdk-lib').Stack) => {
    const template = assertions.Template.fromStack(stack);
    const resources = template.toJSON().Resources as Record<
      string,
      CfnResourceJson
    >;
    const ofType = (type: string) =>
      Object.entries(resources).filter(([, r]) => r.Type === type);
    return { template, resources, ofType };
  };

  const policyStatementsForRole = (
    resources: Record<string, CfnResourceJson>,
    roleLogicalId: string,
  ): any[] =>
    Object.values(resources)
      .filter(
        (r) =>
          r.Type === 'AWS::IAM::Policy' &&
          (r.Properties.Roles ?? []).some(
            (role: any) => role.Ref === roleLogicalId,
          ),
      )
      .flatMap((r) => r.Properties.PolicyDocument.Statement);

  const asArray = <T>(value: T | T[]): T[] =>
    Array.isArray(value) ? value : [value];

  const taskDefinitionOf = (resources: Record<string, CfnResourceJson>) => {
    const taskDefinitions = Object.values(resources).filter(
      (r) => r.Type === 'AWS::ECS::TaskDefinition',
    );
    expect(taskDefinitions).toHaveLength(1);
    return taskDefinitions[0].Properties;
  };

  const skipIds = (resource: CfnResourceJson): string[] =>
    (resource.Metadata?.checkov?.skip ?? []).map((s: any) => s.id);

  describe('defaults (http-api, iam)', () => {
    let env: ReturnType<typeof newService>;
    let out: ReturnType<typeof synth>;

    beforeAll(() => {
      env = newService();
      // Creates the AppConfig resources the runtime config is delivered by.
      void RuntimeConfigModule.RuntimeConfig.ensure(env.stack)
        .appConfigApplicationId;
      out = synth(env.stack);
    });

    it('should run an arm64 Fargate task with a read-only root and a non-root user', () => {
      const taskDefinition = taskDefinitionOf(out.resources);
      expect(taskDefinition.RuntimePlatform).toEqual({
        CpuArchitecture: 'ARM64',
        OperatingSystemFamily: 'LINUX',
      });
      expect(taskDefinition.Cpu).toBe('256');
      expect(taskDefinition.Memory).toBe('512');
      const [container] = taskDefinition.ContainerDefinitions;
      expect(container.ReadonlyRootFilesystem).toBe(true);
      expect(container.User).toBe('1000');
      expect(container.PortMappings[0].ContainerPort).toBe(8080);
      expect(container.Environment).toContainEqual({
        Name: 'PORT',
        Value: '8080',
      });
    });

    it('should run the service without a public IP, with rollback and without ECS Exec', () => {
      const [[, service]] = out.ofType('AWS::ECS::Service');
      expect(
        service.Properties.NetworkConfiguration.AwsvpcConfiguration
          .AssignPublicIp,
      ).toBe('DISABLED');
      expect(
        service.Properties.DeploymentConfiguration.DeploymentCircuitBreaker,
      ).toEqual({ Enable: true, Rollback: true });
      expect(service.Properties.EnableExecuteCommand ?? false).toBe(false);
      expect(service.Properties.PlatformVersion).toBe('LATEST');
      expect(service.Properties.DesiredCount).toBe(1);
    });

    it('should create a cluster with Container Insights on', () => {
      const clusters = out.ofType('AWS::ECS::Cluster');
      expect(clusters).toHaveLength(1);
      expect(clusters[0][1].Properties.ClusterSettings).toEqual([
        { Name: 'containerInsights', Value: 'enabled' },
      ]);
    });

    it('should create an internal load balancer that drops invalid headers', () => {
      const [[, alb]] = out.ofType('AWS::ElasticLoadBalancingV2::LoadBalancer');
      expect(alb.Properties.Scheme).toBe('internal');
      expect(alb.Properties.LoadBalancerAttributes).toContainEqual({
        Key: 'routing.http.drop_invalid_header_fields.enabled',
        Value: 'true',
      });
      expect(skipIds(alb)).toEqual(['CKV_AWS_91']);
    });

    it('should register the tasks as IP targets with the health check and deregistration delay', () => {
      const [[, targetGroup]] = out.ofType(
        'AWS::ElasticLoadBalancingV2::TargetGroup',
      );
      expect(targetGroup.Properties.TargetType).toBe('ip');
      expect(targetGroup.Properties.Port).toBe(8080);
      expect(targetGroup.Properties.HealthCheckPath).toBe('/health');
      expect(targetGroup.Properties.TargetGroupAttributes).toContainEqual({
        Key: 'deregistration_delay.timeout_seconds',
        Value: '30',
      });
    });

    it('should listen on HTTP 80 with the checkov skips', () => {
      const [[, listener]] = out.ofType(
        'AWS::ElasticLoadBalancingV2::Listener',
      );
      expect(listener.Properties.Protocol).toBe('HTTP');
      expect(listener.Properties.Port).toBe(80);
      expect(skipIds(listener).sort()).toEqual(['CKV_AWS_103', 'CKV_AWS_2']);
    });

    it('should front the load balancer with an HTTP API through a VPC link', () => {
      expect(out.ofType('AWS::ApiGatewayV2::Api')).toHaveLength(1);
      expect(out.ofType('AWS::ApiGatewayV2::VpcLink')).toHaveLength(1);
      const [[, integration]] = out.ofType('AWS::ApiGatewayV2::Integration');
      expect(integration.Properties.IntegrationType).toBe('HTTP_PROXY');
      expect(integration.Properties.ConnectionType).toBe('VPC_LINK');
      const [[, route]] = out.ofType('AWS::ApiGatewayV2::Route');
      expect(route.Properties.AuthorizationType).toBe('AWS_IAM');
      const [[, stage]] = out.ofType('AWS::ApiGatewayV2::Stage');
      expect(stage.Properties.AutoDeploy).toBe(true);
      expect(stage.Properties.AccessLogSettings.DestinationArn).toBeDefined();
      expect(stage.Properties.DefaultRouteSettings).toEqual(
        expect.objectContaining({
          ThrottlingRateLimit: 10000,
          ThrottlingBurstLimit: 5000,
        }),
      );
    });

    it('should allow no ingress from anywhere, egress 443 only, with a description on every rule', () => {
      const ingress = [
        ...out
          .ofType('AWS::EC2::SecurityGroup')
          .flatMap(([, sg]) => sg.Properties.SecurityGroupIngress ?? []),
        ...out
          .ofType('AWS::EC2::SecurityGroupIngress')
          .map(([, rule]) => rule.Properties),
      ];
      expect(ingress.length).toBeGreaterThan(0);
      for (const rule of ingress) {
        expect(rule.CidrIp).not.toBe('0.0.0.0/0');
        expect(rule.CidrIpv6).not.toBe('::/0');
        expect(rule.Description).toBeTruthy();
      }
      const egress = [
        ...out
          .ofType('AWS::EC2::SecurityGroup')
          .flatMap(([, sg]) => sg.Properties.SecurityGroupEgress ?? []),
        ...out
          .ofType('AWS::EC2::SecurityGroupEgress')
          .map(([, rule]) => rule.Properties),
      ];
      for (const rule of egress) {
        expect(rule.Description).toBeTruthy();
      }

      const serviceSgId = env.stack.resolve(
        (
          env.service
            .securityGroup as import('aws-cdk-lib/aws-ec2').ISecurityGroup
        ).securityGroupId,
      )['Fn::GetAtt'][0];
      expect(out.resources[serviceSgId].Properties.SecurityGroupEgress).toEqual(
        [
          {
            CidrIp: '0.0.0.0/0',
            Description: 'HTTPS egress',
            FromPort: 443,
            IpProtocol: 'tcp',
            ToPort: 443,
          },
        ],
      );
      expect(
        out
          .ofType('AWS::EC2::SecurityGroupEgress')
          .filter(
            ([, rule]) =>
              rule.Properties.GroupId['Fn::GetAtt']?.[0] === serviceSgId,
          ),
      ).toEqual([]);
    });

    it('should give the task role no permissions', () => {
      const taskRoleId = taskDefinitionOf(out.resources).TaskRoleArn[
        'Fn::GetAtt'
      ][0];
      expect(policyStatementsForRole(out.resources, taskRoleId)).toEqual([]);
    });

    it('should scope the execution role to the image, the logs and nothing else', () => {
      const executionRoleId = taskDefinitionOf(out.resources).ExecutionRoleArn[
        'Fn::GetAtt'
      ][0];
      const statements = policyStatementsForRole(
        out.resources,
        executionRoleId,
      );
      const actions = statements.flatMap((s) => asArray(s.Action)).sort();
      expect(actions).toEqual(
        [
          'ecr:BatchCheckLayerAvailability',
          'ecr:BatchGetImage',
          'ecr:GetAuthorizationToken',
          'ecr:GetDownloadUrlForLayer',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ].sort(),
      );
      const pull = statements.find((s) =>
        asArray(s.Action).includes('ecr:BatchGetImage'),
      );
      expect(asArray(pull.Resource)).toHaveLength(1);
      expect(JSON.stringify(pull.Resource)).toContain(':repository/');
      const token = statements.find((s) =>
        asArray(s.Action).includes('ecr:GetAuthorizationToken'),
      );
      expect(token.Resource).toBe('*');
      const logs = statements.find((s) =>
        asArray(s.Action).includes('logs:PutLogEvents'),
      );
      expect(JSON.stringify(logs.Resource)).toContain('Fn::GetAtt');
    });

    it('should scale on CPU between 1 and 2 tasks', () => {
      const [[, target]] = out.ofType(
        'AWS::ApplicationAutoScaling::ScalableTarget',
      );
      expect(target.Properties.MinCapacity).toBe(1);
      expect(target.Properties.MaxCapacity).toBe(2);
      const [[, policy]] = out.ofType(
        'AWS::ApplicationAutoScaling::ScalingPolicy',
      );
      expect(policy.Properties.PolicyType).toBe('TargetTrackingScaling');
      const config = policy.Properties.TargetTrackingScalingPolicyConfiguration;
      expect(config.PredefinedMetricSpecification.PredefinedMetricType).toBe(
        'ECSServiceAverageCPUUtilization',
      );
      expect(config.TargetValue).toBe(70);
    });

    it('should keep logs for a year, encrypted with a rotated KMS key', () => {
      const logGroups = out.ofType('AWS::Logs::LogGroup');
      expect(logGroups).toHaveLength(2);
      for (const [, logGroup] of logGroups) {
        expect(logGroup.Properties.RetentionInDays).toBe(365);
        expect(logGroup.Properties.KmsKeyId).toBeDefined();
      }
      for (const [, key] of out.ofType('AWS::KMS::Key')) {
        expect(key.Properties.EnableKeyRotation).toBe(true);
      }
    });

    it('should write the URL to runtime config and as an output', () => {
      const services = RuntimeConfigModule.RuntimeConfig.ensure(env.stack).get(
        'connection',
      ).services;
      expect(Object.keys(services)).toEqual(['Orders']);
      expect(services.Orders).toBe(env.service.url);
      const [[, hostedConfiguration]] = out
        .ofType('AWS::AppConfig::HostedConfigurationVersion')
        .filter(([id]) => id.includes('connection'));
      expect(JSON.stringify(hostedConfiguration.Properties.Content)).toContain(
        '\\"Orders\\"',
      );
      expect(Object.keys(out.template.toJSON().Outputs)).toContainEqual(
        expect.stringContaining('OrdersUrl'),
      );
    });

    it('should grant execute-api:Invoke on the API', () => {
      const { stack, service } = newService();
      const role = new iam.Role(stack, 'Caller', {
        assumedBy: new iam.AccountRootPrincipal(),
      });
      service.grantInvoke(role);
      const { resources } = synth(stack);
      const statements = policyStatementsForRole(
        resources,
        stack.resolve(role.roleName).Ref,
      );
      expect(statements).toHaveLength(1);
      expect(statements[0].Action).toBe('execute-api:Invoke');
      expect(JSON.stringify(statements[0].Resource)).toContain(':execute-api:');
    });
  });

  it('should use a Cognito JWT authorizer, and refuse grantInvoke', () => {
    const env = newStack();
    const userPool = new cognito.UserPool(env.stack, 'UserPool');
    const userPoolClient = userPool.addClient('Client');
    const { service } = newService(
      { auth: { type: 'cognito', userPool, userPoolClient } },
      env,
    );
    const { ofType } = synth(env.stack);

    const [[, route]] = ofType('AWS::ApiGatewayV2::Route');
    expect(route.Properties.AuthorizationType).toBe('JWT');
    const [[, authorizer]] = ofType('AWS::ApiGatewayV2::Authorizer');
    expect(authorizer.Properties.JwtConfiguration.Audience).toEqual([
      env.stack.resolve(userPoolClient.userPoolClientId),
    ]);
    expect(() => service.grantInvoke(new iam.AccountRootPrincipal())).toThrow(
      /grantInvoke needs an HTTP API with IAM auth \(service Orders\)/,
    );
  });

  it('should leave the API open with auth none, and refuse grantInvoke', () => {
    const { stack, service } = newService({ auth: { type: 'none' } });
    const { ofType } = synth(stack);

    const [[, route]] = ofType('AWS::ApiGatewayV2::Route');
    expect(route.Properties.AuthorizationType).toBe('NONE');
    expect(ofType('AWS::ApiGatewayV2::Authorizer')).toEqual([]);
    expect(() => service.grantInvoke(new iam.AccountRootPrincipal())).toThrow(
      /grantInvoke needs an HTTP API with IAM auth/,
    );
  });

  it('should restrict CORS to the given origins', () => {
    const { stack, service } = newService();
    service.restrictCorsTo('https://example.com');
    const { ofType } = synth(stack);

    const [[, api]] = ofType('AWS::ApiGatewayV2::Api');
    expect(api.Properties.CorsConfiguration.AllowOrigins).toEqual([
      'https://example.com',
    ]);
    expect(api.Properties.CorsConfiguration.AllowHeaders).toContain(
      'x-amz-security-token',
    );
  });

  it('should reach a private service only from inside the VPC', () => {
    const { stack, vpc, service } = newService({ ingress: 'private' });
    const { ofType, resources } = synth(stack);

    expect(
      Object.values(resources).filter((r) =>
        r.Type.startsWith('AWS::ApiGatewayV2::'),
      ),
    ).toEqual([]);
    const albSgId = stack.resolve(
      (
        service.loadBalancer as import('aws-cdk-lib/aws-elasticloadbalancingv2').ApplicationLoadBalancer
      ).connections.securityGroups[0].securityGroupId,
    )['Fn::GetAtt'][0];
    expect(resources[albSgId].Properties.SecurityGroupIngress).toEqual([
      {
        CidrIp: stack.resolve(vpc.vpcCidrBlock),
        Description: 'HTTP from inside the VPC',
        FromPort: 80,
        IpProtocol: 'tcp',
        ToPort: 80,
      },
    ]);
    expect(ofType('AWS::ElasticLoadBalancingV2::LoadBalancer')).toHaveLength(1);
    const services =
      RuntimeConfigModule.RuntimeConfig.ensure(stack).get(
        'connection',
      ).services;
    expect(JSON.stringify(stack.resolve(services.Orders))).toContain('http://');
  });

  it('should run a worker with no load balancer, API or URL', () => {
    const { stack, service } = newService({ loadBalancer: false });
    const { resources, template } = synth(stack);

    expect(
      Object.values(resources).filter(
        (r) =>
          r.Type.startsWith('AWS::ElasticLoadBalancingV2::') ||
          r.Type.startsWith('AWS::ApiGatewayV2::'),
      ),
    ).toEqual([]);
    expect(service.url).toBeUndefined();
    expect(service.loadBalancer).toBeUndefined();
    expect(service.httpApi).toBeUndefined();
    expect(Object.keys(template.toJSON().Outputs ?? {})).not.toContainEqual(
      expect.stringContaining('Url'),
    );
    expect(
      RuntimeConfigModule.RuntimeConfig.ensure(stack).get('connection')
        .services,
    ).toBeUndefined();
  });

  it('should use a public image URI as is, with no asset', () => {
    const uri = 'public.ecr.aws/docker/library/nginx:latest';
    const { stack, app } = newService({ image: { imageUri: uri } });
    const { resources } = synth(stack);

    expect(taskDefinitionOf(resources).ContainerDefinitions[0].Image).toBe(uri);
    const assembly = app.synth();
    expect(
      assembly
        .getStackByName('Test')
        .assets.filter(
          (asset) => 'imageTag' in asset || 'repositoryName' in asset,
        ),
    ).toEqual([]);
    expect(JSON.stringify(resources)).not.toContain('container-assets');
  });

  it('should grant pull on exactly the given ECR repository', () => {
    const { stack } = newService({
      image: {
        imageUri: '123456789012.dkr.ecr.us-east-1.amazonaws.com/repo:tag',
      },
    });
    const { resources } = synth(stack);

    const executionRoleId =
      taskDefinitionOf(resources).ExecutionRoleArn['Fn::GetAtt'][0];
    const pull = policyStatementsForRole(resources, executionRoleId).find((s) =>
      asArray(s.Action).includes('ecr:BatchGetImage'),
    );
    expect(asArray(pull.Resource)).toHaveLength(1);
    expect(JSON.stringify(pull.Resource)).toContain(
      ':ecr:us-east-1:123456789012:repository/repo',
    );
    expect(JSON.stringify(resources)).not.toContain('container-assets');
  });

  it('should pass secrets by reference and let the execution role read only them', () => {
    const env = newStack();
    const secret = new secretsmanager.Secret(env.stack, 'DbSecret');
    newService(
      { secrets: { DB_PASSWORD: ecs.Secret.fromSecretsManager(secret) } },
      env,
    );
    const { resources } = synth(env.stack);

    const taskDefinition = taskDefinitionOf(resources);
    const [container] = taskDefinition.ContainerDefinitions;
    expect(container.Secrets).toEqual([
      { Name: 'DB_PASSWORD', ValueFrom: env.stack.resolve(secret.secretArn) },
    ]);
    expect((container.Environment ?? []).map((e: any) => e.Name)).not.toContain(
      'DB_PASSWORD',
    );
    const secretStatements = policyStatementsForRole(
      resources,
      taskDefinition.ExecutionRoleArn['Fn::GetAtt'][0],
    ).filter((s) =>
      asArray(s.Action).some((a: string) => a.startsWith('secretsmanager:')),
    );
    expect(secretStatements).toHaveLength(1);
    expect(asArray(secretStatements[0].Action)).toContain(
      'secretsmanager:GetSecretValue',
    );
    expect(secretStatements[0].Resource).toEqual(
      env.stack.resolve(secret.secretArn),
    );
  });

  it('should call grantTaskRole once with the task role', () => {
    const grantTaskRole = vi.fn((role: import('aws-cdk-lib/aws-iam').IRole) => {
      role.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ['s3:GetObject'],
          resources: ['arn:aws:s3:::bucket/*'],
        }),
      );
    });
    const { stack, service } = newService({ grantTaskRole });
    const { resources } = synth(stack);

    expect(grantTaskRole).toHaveBeenCalledTimes(1);
    expect(grantTaskRole).toHaveBeenCalledWith(service.taskRole);
    const taskRoleId = taskDefinitionOf(resources).TaskRoleArn['Fn::GetAtt'][0];
    expect(policyStatementsForRole(resources, taskRoleId)).toEqual([
      expect.objectContaining({
        Action: 's3:GetObject',
        Resource: 'arn:aws:s3:::bucket/*',
      }),
    ]);
  });

  it('should share a cluster that is passed in', () => {
    const env = newStack();
    const cluster = new ecs.Cluster(env.stack, 'Shared', { vpc: env.vpc });
    new EcsServiceModule.EcsService(env.stack, 'One', {
      serviceName: 'One',
      vpc: env.vpc,
      cluster,
      image: { directory: IMAGE_DIR },
    });
    new EcsServiceModule.EcsService(env.stack, 'Two', {
      serviceName: 'Two',
      vpc: env.vpc,
      cluster,
      image: { directory: IMAGE_DIR },
      ingress: 'private',
    });
    const { ofType } = synth(env.stack);

    expect(ofType('AWS::ECS::Cluster')).toHaveLength(1);
    expect(ofType('AWS::ECS::Service')).toHaveLength(2);
    expect(
      Object.keys(
        RuntimeConfigModule.RuntimeConfig.ensure(env.stack).get('connection')
          .services,
      ).sort(),
    ).toEqual(['One', 'Two']);
  });

  describe('service construct', () => {
    // Synthesizes the vended per-service subclass (`app/services/orders.ts`).
    const newOrders = (props: Record<string, unknown> = {}) => {
      const env = newStack();
      const service = new ServiceModule.Orders(env.stack, 'Orders', {
        vpc: env.vpc,
        image: { directory: IMAGE_DIR },
        ...props,
      });
      return { ...env, service, out: synth(env.stack) };
    };

    it('should pass RUNTIME_CONFIG_APP_ID to the container', () => {
      const { stack, out } = newOrders({ environment: { FOO: 'bar' } });

      const [container] = taskDefinitionOf(out.resources).ContainerDefinitions;
      expect(container.Environment).toContainEqual({
        Name: 'RUNTIME_CONFIG_APP_ID',
        Value: stack.resolve(
          RuntimeConfigModule.RuntimeConfig.ensure(stack)
            .appConfigApplicationId,
        ),
      });
      expect(container.Environment).toContainEqual({
        Name: 'FOO',
        Value: 'bar',
      });
      expect(container.Environment).toContainEqual({
        Name: 'PORT',
        Value: '8080',
      });
    });

    it('should let the task role read runtime config from AppConfig, and keep grantTaskRole', () => {
      const grantTaskRole = vi.fn(
        (role: import('aws-cdk-lib/aws-iam').IRole) => {
          role.addToPrincipalPolicy(
            new iam.PolicyStatement({
              actions: ['s3:GetObject'],
              resources: ['arn:aws:s3:::bucket/*'],
            }),
          );
        },
      );
      const { stack, service, out } = newOrders({ grantTaskRole });

      expect(grantTaskRole).toHaveBeenCalledWith(service.taskRole);
      const taskRoleId = taskDefinitionOf(out.resources).TaskRoleArn[
        'Fn::GetAtt'
      ][0];
      const statements = policyStatementsForRole(out.resources, taskRoleId);
      const appConfigRead = statements.filter((s) =>
        asArray(s.Action).includes('appconfig:GetLatestConfiguration'),
      );
      expect(appConfigRead).toHaveLength(1);
      expect(asArray(appConfigRead[0].Action).sort()).toEqual([
        'appconfig:GetLatestConfiguration',
        'appconfig:StartConfigurationSession',
      ]);
      const appRef = stack.resolve(
        RuntimeConfigModule.RuntimeConfig.ensure(stack).appConfigApplicationId,
      );
      expect(JSON.stringify(appConfigRead[0].Resource)).toContain(
        ':appconfig:',
      );
      expect(JSON.stringify(appConfigRead[0].Resource)).toContain(
        JSON.stringify(appRef),
      );
      expect(statements).toContainEqual(
        expect.objectContaining({
          Action: 's3:GetObject',
          Resource: 'arn:aws:s3:::bucket/*',
        }),
      );
    });
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    [
      'ingress without a load balancer',
      { loadBalancer: false, ingress: 'http-api' },
      /ingress and auth need a load balancer \(service Orders\)/,
    ],
    [
      'auth without a load balancer',
      { loadBalancer: false, auth: { type: 'iam' } },
      /ingress and auth need a load balancer \(service Orders\)/,
    ],
    [
      'auth with private ingress',
      { ingress: 'private', auth: { type: 'iam' } },
      /auth needs ingress 'http-api' \(service Orders\)/,
    ],
  ])('should reject %s', (_, props, message) => {
    expect(() => newService(props)).toThrow(message);
  });
});
