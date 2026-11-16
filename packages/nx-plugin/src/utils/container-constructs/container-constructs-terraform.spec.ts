/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, type Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { declareDependencies } from '../declared-dependencies.js';
import { sharedConstructsGenerator } from '../shared-constructs.js';
import { SHARED_CONSTRUCTS_DEPENDENCIES } from '../shared-constructs-constants.js';
import { createTreeUsingTsSolutionSetup } from '../test.js';
import {
  type AddContainerServiceInfraOptions,
  addContainerServiceInfra,
} from './container-constructs.js';
import { addContainerServiceTerraformModules } from './container-constructs-terraform.js';

const TERRAFORM_SRC = 'packages/common/terraform/src';
const CORE_DIR = `${TERRAFORM_SRC}/core/container/ecs-service`;
const CORE_FILES = {
  module: `${CORE_DIR}/ecs-service.tf`,
  variables: `${CORE_DIR}/variables.tf`,
  outputs: `${CORE_DIR}/outputs.tf`,
};
const APP_FILE = `${TERRAFORM_SRC}/app/services/orders/orders.tf`;

/** Output names fixed by the contract, in declaration order. */
const CONTRACT_OUTPUTS = [
  'cluster_arn',
  'service_name',
  'service_arn',
  'task_role_arn',
  'task_role_name',
  'security_group_id',
  'load_balancer_arn',
  'load_balancer_dns_name',
  'api_id',
  'api_execution_arn',
  'url',
];

/** Variable names fixed by the contract. */
const CONTRACT_VARIABLES = [
  'service_name',
  'vpc_id',
  'subnet_ids',
  'cluster_arn',
  'image_uri',
  'container_port',
  'cpu',
  'memory',
  'desired_count',
  'min_capacity',
  'max_capacity',
  'target_cpu_utilization',
  'environment',
  'secrets',
  'load_balancer',
  'health_check_path',
  'deregistration_delay',
  'ingress',
  'auth',
  'user_pool_id',
  'user_pool_client_ids',
  'log_retention_days',
  'task_role_policy_statements',
  'tags',
];

const outputNames = (hcl: string): string[] =>
  [...hcl.matchAll(/^output "([^"]+)" \{/gm)].map(([, name]) => name);

const variableNames = (hcl: string): string[] =>
  [...hcl.matchAll(/^variable "([^"]+)" \{/gm)].map(([, name]) => name);

/**
 * Top-level HCL blocks, scanned textually as `runtime-config-namespaces.spec.ts`
 * does: a block opens on a column-0 line ending in `{` and closes on `}`.
 */
const topLevelBlocks = (contents: string): string[] => {
  const blocks: string[] = [];
  let current: string[] | undefined;
  for (const line of contents.split('\n')) {
    if (current === undefined) {
      if (/^\w+\s.*\{\s*$/.test(line)) {
        current = [line];
      }
      continue;
    }
    current.push(line);
    if (line === '}') {
      blocks.push(current.join('\n'));
      current = undefined;
    }
  }
  return blocks;
};

const blocksOf = (contents: string, header: string): string[] =>
  topLevelBlocks(contents).filter((block) => block.startsWith(header));

const BASE_OPTIONS: AddContainerServiceInfraOptions = {
  nameClassName: 'Orders',
  nameKebabCase: 'orders',
  projectName: '@proj/svc',
  dockerImageTag: 'proj-orders:latest',
  dockerBuildContextDir: 'dist/packages/svc/orders/docker',
  containerPort: 8080,
  ingress: 'http-api',
  auth: 'iam',
  containers: 'docker',
};

const VARIANTS: Pick<AddContainerServiceInfraOptions, 'ingress' | 'auth'>[] = [
  { ingress: 'http-api', auth: 'iam' },
  { ingress: 'http-api', auth: 'cognito' },
  { ingress: 'http-api', auth: 'none' },
  // auth is passed but must be ignored for private
  { ingress: 'private', auth: 'iam' },
];

describe('addContainerServiceTerraformModules', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = createTreeUsingTsSolutionSetup();
    await sharedConstructsGenerator(
      tree,
      { iac: 'terraform' },
      declareDependencies()({ ts: [...SHARED_CONSTRUCTS_DEPENDENCIES] }),
    );
  });

  const render = (overrides: Partial<AddContainerServiceInfraOptions> = {}) =>
    addContainerServiceTerraformModules(tree, {
      ...BASE_OPTIONS,
      ...overrides,
    });

  const read = (path: string): string => tree.read(path, 'utf-8') ?? '';

  const readCore = () => ({
    module: read(CORE_FILES.module),
    variables: read(CORE_FILES.variables),
    outputs: read(CORE_FILES.outputs),
  });

  const vendedFiles = (): Record<string, string> =>
    Object.fromEntries(
      tree
        .listChanges()
        .filter(
          (change) =>
            change.content !== null &&
            (change.path.startsWith(`${TERRAFORM_SRC}/core/container/`) ||
              change.path.startsWith(`${TERRAFORM_SRC}/app/services/`)),
        )
        .map((change) => [change.path, read(change.path)]),
    );

  describe('snapshots', () => {
    it('should render the core module', async () => {
      await render();

      const core = readCore();
      for (const path of Object.values(CORE_FILES)) {
        expect(tree.exists(path), path).toBe(true);
      }
      expect(core.module).toMatchSnapshot('ecs-service.tf');
      expect(core.variables).toMatchSnapshot('variables.tf');
      expect(core.outputs).toMatchSnapshot('outputs.tf');
    });

    it.each(VARIANTS)(
      'should render the app module for ingress=$ingress auth=$auth',
      async (variant) => {
        await render(variant);

        expect(tree.exists(APP_FILE)).toBe(true);
        expect(read(APP_FILE)).toMatchSnapshot();
      },
    );
  });

  it('should leave every file unchanged when rendered twice', async () => {
    await render();
    const first = vendedFiles();

    await render();

    expect(Object.keys(first).length).toBeGreaterThan(0);
    expect(vendedFiles()).toEqual(first);
  });

  it('should add a second service without touching the core module', async () => {
    await render();
    const core = readCore();

    await render({ nameClassName: 'Billing', nameKebabCase: 'billing' });

    expect(
      tree.exists(`${TERRAFORM_SRC}/app/services/billing/billing.tf`),
    ).toBe(true);
    expect(readCore()).toEqual(core);
  });

  it('should write the service URL to runtime config under connection.services', async () => {
    await render();

    const [entry] = topLevelBlocks(read(APP_FILE)).filter((block) =>
      /source\s*=\s*"[^"]*runtime-config\/entry"/.test(block),
    );
    expect(entry).toBeDefined();
    expect(entry).toContain('source = "../../../core/runtime-config/entry"');
    expect(/^\s*namespace\s*=\s*"([^"]+)"\s*$/m.exec(entry)?.[1]).toBe(
      'connection',
    );
    expect(entry).toMatch(/^\s*key\s*=\s*"services"\s*$/m);
    expect(entry).toContain('"Orders" = module.ecs_service.url');
  });

  it('should give the service RUNTIME_CONFIG_APP_ID and read access to runtime config', async () => {
    await render();

    const app = read(APP_FILE);
    for (const name of [
      'appconfig_application_id',
      'appconfig_application_arn',
    ]) {
      const [variable] = blocksOf(app, `variable "${name}"`);
      expect(variable, name).toBeDefined();
      expect(variable).toContain('type        = string');
      // Required, as in the agent module: a container without runtime config
      // fails at plan time instead of at runtime.
      expect(variable).not.toMatch(/^\s*default\s*=/m);
    }
    const [ecsService] = blocksOf(app, 'module "ecs_service"');
    expect(ecsService).toMatch(/^\s*environment\s*=\s*local\.environment$/m);
    expect(ecsService).toMatch(
      /^\s*task_role_policy_statements\s*=\s*local\.task_role_policy_statements$/m,
    );
    const [locals] = topLevelBlocks(app).filter(
      (block) =>
        block.startsWith('locals {') && block.includes('RUNTIME_CONFIG_APP_ID'),
    );
    expect(locals).toMatch(
      /^\s*environment\s*=\s*merge\(\{\n\s*RUNTIME_CONFIG_APP_ID = var\.appconfig_application_id\n\s*\}, var\.environment\)$/m,
    );
    expect(locals).toMatch(/^\s*task_role_policy_statements\s*=\s*concat\(\[/m);
    expect(locals).toContain('"appconfig:StartConfigurationSession"');
    expect(locals).toContain('"appconfig:GetLatestConfiguration"');
    expect(locals).toMatch(
      /Resource = \["\$\{var\.appconfig_application_arn\}\/\*"\]/,
    );
    expect(locals).toMatch(/\], var\.task_role_policy_statements\)$/m);
  });

  it.each(VARIANTS)(
    'should open no security group to the internet for ingress=$ingress auth=$auth',
    async (variant) => {
      await render(variant);

      for (const contents of [read(CORE_FILES.module), read(APP_FILE)]) {
        const ingressRules = blocksOf(
          contents,
          'resource "aws_vpc_security_group_ingress_rule"',
        );
        for (const rule of ingressRules) {
          expect(rule).not.toContain('0.0.0.0/0');
          expect(rule).not.toContain('::/0');
        }
        for (const group of blocksOf(
          contents,
          'resource "aws_security_group" ',
        )) {
          expect(group).not.toMatch(/^\s*ingress\s*\{/m);
          expect(group).not.toMatch(/^\s*egress\s*\{/m);
        }
      }
      expect(
        blocksOf(
          read(CORE_FILES.module),
          'resource "aws_vpc_security_group_ingress_rule"',
        ).length,
      ).toBeGreaterThan(0);
    },
  );

  it('should vend the hardening defaults', async () => {
    await render();

    const core = read(CORE_FILES.module);
    expect(core).toContain('assign_public_ip = false');
    expect(core).toContain('readonlyRootFilesystem = true');
    expect(core).toMatch(/^\s*internal\s*=\s*true$/m);
    expect(core).toMatch(/^\s*enable_execute_command\s*=\s*false$/m);
    expect(core).toMatch(/^\s*rollback\s*=\s*true$/m);
    expect(core).toContain('cpu_architecture        = "ARM64"');
  });

  it('should manage the Container Insights log group so destroy removes it', async () => {
    await render();

    const core = read(CORE_FILES.module);
    expect(core).toMatch(
      /^\s*container_insights_log_group_name = "\/aws\/ecs\/containerinsights\/\$\{local\.name\}\/performance"$/m,
    );
    const [logGroup] = blocksOf(
      core,
      'resource "aws_cloudwatch_log_group" "container_insights"',
    );
    expect(logGroup).toBeDefined();
    expect(logGroup).toContain('count = local.create_cluster ? 1 : 0');
    expect(logGroup).toMatch(
      /^\s*name\s*=\s*local\.container_insights_log_group_name$/m,
    );
    expect(logGroup).toMatch(
      /^\s*retention_in_days\s*=\s*var\.log_retention_days$/m,
    );
    expect(logGroup).toMatch(/^\s*kms_key_id\s*=\s*aws_kms_key\.logs\.arn$/m);

    const [cluster] = blocksOf(core, 'resource "aws_ecs_cluster" "this"');
    expect(cluster).toMatch(/^\s*name\s*=\s*local\.name$/m);
    expect(cluster).toContain(
      'depends_on = [aws_cloudwatch_log_group.container_insights]',
    );

    const [key] = blocksOf(core, 'resource "aws_kms_key" "logs"');
    expect(key).toMatch(
      /log-group:\$\{local\.container_insights_log_group_name\}"/,
    );
  });

  it('should give the task role no permissions by default', async () => {
    await render();

    const core = read(CORE_FILES.module);
    const [taskPolicy] = blocksOf(
      core,
      'resource "aws_iam_role_policy" "task"',
    );
    expect(taskPolicy).toBeDefined();
    expect(taskPolicy).toContain(
      'count = length(var.task_role_policy_statements) > 0 ? 1 : 0',
    );
    const [variable] = blocksOf(
      read(CORE_FILES.variables),
      'variable "task_role_policy_statements"',
    );
    expect(variable).toMatch(/^\s*default\s*=\s*\[\]$/m);
    expect(core).not.toContain('aws_iam_role_policy_attachment');
    expect(core).not.toContain('managed_policy_arns');
    const [taskRole] = blocksOf(core, 'resource "aws_iam_role" "task"');
    expect(taskRole).not.toContain('inline_policy');
  });

  it('should keep the contract output and variable names', async () => {
    await render();

    const core = readCore();
    expect(outputNames(core.outputs)).toEqual(CONTRACT_OUTPUTS);
    expect(core.outputs).not.toContain('TODO');
    expect(core.outputs).not.toMatch(/value\s*=\s*null/);
    expect(variableNames(core.variables)).toEqual(
      expect.arrayContaining(CONTRACT_VARIABLES),
    );
  });

  it('should re-export every core output from the app module', async () => {
    await render();

    const app = read(APP_FILE);
    expect(outputNames(app)).toEqual(CONTRACT_OUTPUTS);
    for (const name of CONTRACT_OUTPUTS) {
      expect(app).toContain(`value       = module.ecs_service.${name}`);
    }
  });

  describe('variant wiring', () => {
    it('should pass no auth for private ingress', async () => {
      await render({ ingress: 'private', auth: 'iam' });

      const app = read(APP_FILE);
      expect(app).toMatch(/^\s*ingress\s*=\s*"private"$/m);
      expect(app).not.toMatch(/^\s*auth\s*=/m);
      expect(app).not.toContain('user_pool_id');
    });

    it('should take and pass the user pool for cognito', async () => {
      await render({ auth: 'cognito' });

      const app = read(APP_FILE);
      expect(variableNames(app)).toEqual(
        expect.arrayContaining(['user_pool_id', 'user_pool_client_ids']),
      );
      expect(app).toMatch(/^\s*auth\s*=\s*"cognito"$/m);
      expect(app).toMatch(/^\s*user_pool_id\s*=\s*var\.user_pool_id$/m);
      expect(app).toMatch(
        /^\s*user_pool_client_ids\s*=\s*var\.user_pool_client_ids$/m,
      );
    });

    it.each(['iam', 'none'] as const)(
      'should take no user pool for auth=%s',
      async (auth) => {
        await render({ auth });

        const app = read(APP_FILE);
        expect(app).toMatch(new RegExp(`^\\s*auth\\s*=\\s*"${auth}"$`, 'm'));
        expect(app).not.toContain('user_pool_id');
      },
    );

    it('should render the same core module for every variant', async () => {
      const cores = [];
      for (const variant of VARIANTS) {
        tree = createTreeUsingTsSolutionSetup();
        await sharedConstructsGenerator(
          tree,
          { iac: 'terraform' },
          declareDependencies()({ ts: [...SHARED_CONSTRUCTS_DEPENDENCIES] }),
        );
        await render(variant);
        cores.push(readCore());
      }

      expect(cores[0].module).not.toBe('');
      for (const core of cores.slice(1)) {
        expect(core).toEqual(cores[0]);
      }
    });
  });

  describe('image publish', () => {
    it('should publish the local image to the shared asset repository', async () => {
      await render();

      const app = read(APP_FILE);
      expect(app).toContain('data "external" "docker_digest"');
      expect(app).toMatch(/docker inspect \$\{var\.docker_image_tag\}/);
      expect(app).toMatch(/default\s*=\s*"proj-orders:latest"/);
      expect(app).toContain('repository_url   = var.asset_ecr_repository_url');
      expect(app).toMatch(
        /^\s*image_repository_arn\s*=\s*var\.asset_ecr_repository_arn$/m,
      );
      expect(app).not.toContain('finch');
    });

    it('should use finch when the workspace uses finch', async () => {
      await render({ containers: 'finch' });

      const app = read(APP_FILE);
      expect(app).toMatch(/finch inspect \$\{var\.docker_image_tag\}/);
      expect(app).toContain('finch push');
      expect(app).not.toMatch(/\bdocker (inspect|login|tag|push)\b/);
    });
  });

  it('should vend the modules through the dispatcher and build the service first', async () => {
    await addContainerServiceInfra(tree, { ...BASE_OPTIONS, iac: 'terraform' });

    expect(tree.exists(APP_FILE)).toBe(true);
    expect(tree.exists(CORE_FILES.module)).toBe(true);
    const project = readJson(tree, 'packages/common/terraform/project.json');
    expect(project.targets.build.dependsOn).toContain('@proj/svc:build');
  });
});
