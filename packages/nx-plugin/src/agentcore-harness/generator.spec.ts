/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, readProjectConfiguration, type Tree } from '@nx/devkit';
import yaml from 'js-yaml';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../utils/config/utils.js';
import { expectHasMetricTags } from '../utils/metrics-assertions.js';
import { createTreeUsingTsSolutionSetup, snapshotTreeDir } from '../utils/test.js';
import { TS_VERSIONS } from '../utils/versions.js';
import {
  AGENTCORE_HARNESS_GENERATOR_INFO,
  agentcoreHarnessGenerator,
  readAgentCoreHarnessMetadata,
} from './generator.js';
import type { AgentcoreHarnessGeneratorSchema } from './schema';
import harnessSchema from './schema.json' with { type: 'json' };

const PROJECT_ROOT = 'packages/my-harness';
const PROJECT_NAME = '@proj/my-harness';
const CDK_CONSTRUCT_PATH =
  'packages/common/constructs/src/app/harnesses/my-harness/my-harness.ts';
const CDK_HARNESSES_INDEX_PATH =
  'packages/common/constructs/src/app/harnesses/index.ts';
const CDK_APP_INDEX_PATH = 'packages/common/constructs/src/app/index.ts';

/** Module path for an already-kebab-case name, which keys its directory. */
const tfModulePath = (name: string) =>
  `packages/common/terraform/src/app/harnesses/${name}/${name}.tf`;
const TF_MODULE_PATH = tfModulePath('my-harness');

/** Exact target contract the generator declares inline. */
const CHAT_TARGET = {
  executor: 'nx:run-commands',
  options: {
    commands: ['tsx ./scripts/chat.ts'],
    cwd: '{projectRoot}',
  },
};

/** Exactly what `scripts/chat.ts` imports, sorted. */
const CHAT_DEPENDENCIES = [
  '@aws-lambda-powertools/parameters',
  '@aws-sdk/client-appconfigdata',
  '@aws-sdk/client-bedrock-agentcore',
  'agent-chat-cli',
];

/** `@types/node` types `node:crypto`; `tsx` runs the script. No `typescript`. */
const CHAT_DEV_DEPENDENCIES = ['@types/node', 'tsx'];

/** The six options schema.json retains, in declaration order. */
const SCHEMA_OPTIONS = [
  'name',
  'directory',
  'subDirectory',
  'infra',
  'iac',
  'preferInstallDependencies',
];

/**
 * Compile-time mirror of `AgentcoreHarnessGeneratorSchema`: adding a field to
 * or removing one from the interface fails to compile here, and the runtime
 * assertion below compares these keys against schema.json.
 */
const SCHEMA_INTERFACE_OPTIONS: Record<
  keyof AgentcoreHarnessGeneratorSchema,
  true
> = {
  name: true,
  directory: true,
  subDirectory: true,
  infra: true,
  iac: true,
  preferInstallDependencies: true,
};

/**
 * Every checkov finding the Terraform module suppresses, justified inline —
 * the wildcard-resource IAM statements, plus the security group whose
 * attachment checkov cannot resolve. The rule ids differ from the CDK
 * template's because checkov ships separate rule sets for HCL and
 * CloudFormation.
 */
const TF_CHECKOV_SKIPS = [
  'CKV2_AWS_5:Attached to the Harness via its network configuration; Checkov cannot resolve this reference',
  'CKV_AWS_355:EcrManagedImageToken requires a wildcard resource; ecr:GetAuthorizationToken has no resource-level permission',
  'CKV_AWS_355:EcrPublicTokenAccess requires a wildcard resource; ecr-public:GetAuthorizationToken has no resource-level permission',
  'CKV_AWS_355:StsForEcrPublicPull requires a wildcard resource; sts:GetServiceBearerToken has no resource-level permission',
  'CKV_AWS_355:XRayTracingAccess requires a wildcard resource; the X-Ray segment and sampling APIs have no resource-level permission',
  'CKV_AWS_290:XRayTracingAccess requires a wildcard resource; the X-Ray segment and sampling APIs have no resource-level permission',
  'CKV_AWS_355:CloudWatchMetricsPublish requires a wildcard resource; cloudwatch:PutMetricData is scoped by the namespace condition instead',
  'CKV_AWS_290:CloudWatchMetricsPublish requires a wildcard resource; cloudwatch:PutMetricData is scoped by the namespace condition instead',
];

/** Dependency key sets declared in the workspace root manifest. */
const rootDependencyKeys = (tree: Tree) => {
  const manifest = readJson(tree, 'package.json');
  return {
    dependencies: Object.keys(manifest.dependencies ?? {}),
    devDependencies: Object.keys(manifest.devDependencies ?? {}),
  };
};

/** Keys present after a generator run but not before it, sorted. */
const addedKeys = (before: string[], after: string[]): string[] =>
  after.filter((key) => !before.includes(key)).sort();

/** Every file under a directory, relative to it, sorted. */
const filesUnder = (tree: Tree, dir: string): string[] => {
  const walk = (path: string): string[] =>
    tree.isFile(path)
      ? [path]
      : tree.children(path).flatMap((child) => walk(`${path}/${child}`));
  return walk(dir)
    .map((path) => path.slice(dir.length + 1))
    .sort();
};

describe('agentcore-harness generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('common behaviour', () => {
    it('generates exactly the four harness project files', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });

      // Set equality, so a leftover invoke.ts or tsconfig.json fails too.
      expect(filesUnder(tree, PROJECT_ROOT)).toEqual([
        'README.md',
        'project.json',
        'scripts/chat.ts',
        'src/PROMPT.md',
      ]);

      const config = readProjectConfiguration(tree, PROJECT_NAME);
      expect(config.root).toBe(PROJECT_ROOT);
      expect(config.projectType).toBe('application');
    });

    it('exposes exactly one target, chat, running the vended script', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      // Set equality, so a leftover invoke or build target fails too.
      const config = readProjectConfiguration(tree, PROJECT_NAME);
      expect(config.targets).toEqual({ chat: CHAT_TARGET });
    });

    it('records exactly the four metadata fields when no infra is written', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      const config = readProjectConfiguration(tree, PROJECT_NAME);
      expect(config.metadata as any).toEqual({
        generator: AGENTCORE_HARNESS_GENERATOR_INFO.id,
        name: 'my-harness',
        rc: 'MyHarness',
        auth: 'iam',
      });
    });

    // The recorded provider is what the declaration's predicates read, so the
    // version sync claims exactly the shared constructs packages this project
    // caused to be added.
    it.each(['cdk', 'terraform'] as const)(
      'records the resolved provider for iac: %s',
      async (iac) => {
        await agentcoreHarnessGenerator(tree, { name: 'my-harness', iac });

        const config = readProjectConfiguration(tree, PROJECT_NAME);
        expect(config.metadata as any).toEqual({
          generator: AGENTCORE_HARNESS_GENERATOR_INFO.id,
          name: 'my-harness',
          rc: 'MyHarness',
          auth: 'iam',
          iac,
        });
      },
    );

    // The generator reads `options.iac` straight through to resolveIac, so
    // these defaults are what make a CLI run that passes neither flag vend
    // infrastructure for the workspace's configured provider.
    it('defaults infra to agentcore and iac to inherit', () => {
      expect(harnessSchema.properties.infra.default).toBe('agentcore');
      expect(harnessSchema.properties.iac.default).toBe('inherit');
    });

    // The `inherit` path itself, which the schema default selects.
    it('vends infrastructure for the inherited provider', async () => {
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, { iac: { provider: 'cdk' } });

      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'inherit',
      });

      expect(tree.exists(CDK_CONSTRUCT_PATH)).toBe(true);
      expect(tree.read(CDK_HARNESSES_INDEX_PATH, 'utf-8')).toContain(
        "export * from './my-harness/my-harness.js';",
      );
      expect(
        (readProjectConfiguration(tree, PROJECT_NAME).metadata as any).iac,
      ).toBe('cdk');
    });

    it('adds the generator metric tag', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });
      expectHasMetricTags(tree, AGENTCORE_HARNESS_GENERATOR_INFO.metric);
    });

    it.each([
      { placement: {}, root: PROJECT_ROOT },
      {
        placement: { directory: 'apps', subDirectory: 'harnesses/my-harness' },
        root: 'apps/harnesses/my-harness',
      },
    ])(
      'resolves the prompt path at $root for both providers',
      async ({ placement, root }) => {
        await agentcoreHarnessGenerator(tree, {
          name: 'my-harness',
          iac: 'cdk',
          ...placement,
        });

        expect(tree.exists(`${root}/src/PROMPT.md`)).toBe(true);
        // Workspace-root-relative, joined onto findWorkspaceRoot() at synth.
        expect(tree.read(CDK_CONSTRUCT_PATH, 'utf-8')).toContain(
          `'${root}/src/PROMPT.md'`,
        );

        const terraformTree = createTreeUsingTsSolutionSetup();
        await agentcoreHarnessGenerator(terraformTree, {
          name: 'my-harness',
          iac: 'terraform',
          ...placement,
        });

        expect(terraformTree.exists(`${root}/src/PROMPT.md`)).toBe(true);
        // Seven `../` segments walk from the module to the workspace root.
        expect(terraformTree.read(TF_MODULE_PATH, 'utf-8')).toContain(
          `file("\${path.module}/../../../../../../../${root}/src/PROMPT.md")`,
        );
      },
    );

    it('reads harness metadata and rejects a foreign project', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      const config = readProjectConfiguration(tree, PROJECT_NAME);
      expect(readAgentCoreHarnessMetadata(config)).toEqual({
        generator: AGENTCORE_HARNESS_GENERATOR_INFO.id,
        name: 'my-harness',
        rc: 'MyHarness',
        auth: 'iam',
      });

      expect(() =>
        readAgentCoreHarnessMetadata({
          ...config,
          metadata: { generator: 'ts#project' } as any,
        }),
      ).toThrow(
        `Project '${PROJECT_NAME}' was not generated by the '${AGENTCORE_HARNESS_GENERATOR_INFO.id}' generator.`,
      );
    });
  });

  describe('dependencies and schema', () => {
    it('adds exactly the dependencies scripts/chat.ts needs', async () => {
      const before = rootDependencyKeys(tree);

      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      // Key sets, not pinned versions: the requirement is which dependencies
      // are added, so a version bump does not churn the test.
      const after = rootDependencyKeys(tree);
      expect(addedKeys(before.dependencies, after.dependencies)).toEqual(
        CHAT_DEPENDENCIES,
      );
      expect(addedKeys(before.devDependencies, after.devDependencies)).toEqual(
        CHAT_DEV_DEPENDENCIES,
      );

      // They land on the workspace root manifest as catalog references, with
      // the pinned version recorded in the pnpm catalog.
      const manifest = readJson(tree, 'package.json');
      const declared = {
        ...manifest.dependencies,
        ...manifest.devDependencies,
      };
      const { catalog } = yaml.load(
        tree.read('pnpm-workspace.yaml', 'utf-8') ?? '',
      ) as { catalog?: Record<string, string> };
      for (const dep of [...CHAT_DEPENDENCIES, ...CHAT_DEV_DEPENDENCIES]) {
        expect(declared[dep], dep).toBe('catalog:');
        expect(catalog?.[dep], dep).toMatch(/^\d+\.\d+\.\d+/);
      }
    });

    it('adds no typescript dependency: no generated target runs tsc', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      const { dependencies, devDependencies } = rootDependencyKeys(tree);
      expect(dependencies).not.toContain('typescript');
      expect(devDependencies).not.toContain('typescript');
      // TS_VERSIONS keeps its typescript entry: workspace init and sibling
      // generators read it.
      expect(TS_VERSIONS.typescript).toBeDefined();
    });

    it('exposes exactly the six retained options', () => {
      // Equality, so a reintroduced modelId or systemPrompt fails.
      expect(Object.keys(harnessSchema.properties)).toEqual(SCHEMA_OPTIONS);
      expect(Object.keys(SCHEMA_INTERFACE_OPTIONS)).toEqual(SCHEMA_OPTIONS);
      expect(harnessSchema.required).toEqual(['name']);
    });
  });

  describe('CDK iac', () => {
    /** The construct as rendered for the default `packages/my-harness` root. */
    let construct: string;

    beforeEach(async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });
      construct = tree.read(CDK_CONSTRUCT_PATH, 'utf-8') ?? '';
    });

    it('emits the construct, exports it, and inlines the model id and prompt read', () => {
      expect(construct).toContain('export class MyHarness');
      expect(construct).toContain('extends Construct');
      // ESM workspace, so addStarExport keeps the `.js` specifier suffix.
      expect(tree.read(CDK_HARNESSES_INDEX_PATH, 'utf-8')).toContain(
        "export * from './my-harness/my-harness.js';",
      );
      expect(tree.read(CDK_APP_INDEX_PATH, 'utf-8')).toContain(
        "export * from './harnesses/index.js';",
      );
      expect(construct).toContain(
        "modelId: 'global.anthropic.claude-sonnet-4-6',",
      );
      // Anchoring on findWorkspaceRoot keeps the read correct once the
      // construct compiles to dist/; a source-relative path would not.
      expect(construct).toContain('fs.readFileSync(');
      expect(construct).toContain(
        'findWorkspaceRoot(url.fileURLToPath(new URL(import.meta.url)))',
      );
      expect(construct).toContain('systemPrompt: [{ text: systemPrompt }],');
    });

    it('grants the private ECR pull a VPC Harness needs, and only then', () => {
      // In a VPC the Harness pulls its managed container from a private ECR
      // repository rather than ECR Public, so the role needs pull permissions
      // on it or sessions fail to start.
      expect(construct).toContain("sid: 'EcrManagedImagePull',");
      expect(construct).toContain(
        '`arn:${stack.partition}:ecr:${stack.region}:*:repository/harness-*`',
      );
      expect(construct).toContain("sid: 'EcrManagedImageToken',");
      // Conditional on the VPC prop, spread into the baseline statements.
      expect(construct).toContain('...(vpc\n');

      // ECR Public remains the non-VPC path, so both stay.
      expect(construct).toContain("sid: 'EcrPublicTokenAccess',");
    });

    it('suppresses the four unscopeable IAM statements on the role policy', () => {
      // App-level specifier: the construct sits three directories below core/.
      expect(construct).toContain(
        "import { suppressRules } from '../../../core/checkov.js';",
      );
      expect(construct).toContain(
        "const WILDCARD_IAM_RULES = ['CKV_AWS_107', 'CKV_AWS_111', 'CKV_AWS_356'];",
      );
      // suppressRules targets a CfnResource, so the suppression lands on the
      // role's policy and each sid stays traceable in its reason.
      expect(construct).toContain(
        'const isPolicy = (c: IConstruct) => c instanceof iam.Policy;',
      );
      expect(construct.match(/suppressRules\(\n/g)).toHaveLength(4);
      for (const reason of [
        'EcrPublicTokenAccess: ecr-public:GetAuthorizationToken has no resource-level permission.',
        'StsForEcrPublicPull: sts:GetServiceBearerToken has no resource-level permission.',
        'XRayTracingAccess: X-Ray segment and sampling APIs have no resource-level permission.',
      ]) {
        expect(construct, reason).toContain(`        '${reason}',`);
      }
      // The VPC-only grant is suppressed inside the matching conditional, so it
      // is indented one level further.
      expect(construct).toContain(
        "          'EcrManagedImageToken: ecr:GetAuthorizationToken has no resource-level permission.',",
      );
    });

    it('configures no tools on the resource but exposes allowedTools as props', () => {
      // The service treats an absent allowedTools as every tool, so the
      // construct defaults it to none and always passes it explicitly.
      expect(construct).toContain('allowedTools = [],');

      // Assigned after the harnessProps spread, so an undefined value from a
      // caller cannot reinstate the service's every-tool default.
      const resourceStart = construct.indexOf('new agentcore.CfnHarness(');
      expect(resourceStart).toBeGreaterThan(0);
      const resource = construct.slice(resourceStart);
      expect(resource).toContain('allowedTools,');
      expect(resource.indexOf('...harnessProps,')).toBeLessThan(
        resource.indexOf('allowedTools,'),
      );

      // Omitted from the inherited native props, so the optional field below
      // is the only route by which a caller can supply tools.
      expect(construct).toContain(
        "Omit<agentcore.CfnHarnessProps, 'executionRoleArn' | 'allowedTools'>",
      );
      expect(construct).toContain(
        "allowedTools?: agentcore.CfnHarnessProps['allowedTools'];",
      );
    });

    // IConnectable, so a VPC resource can grant the Harness port access with
    // the same `connections` idiom every other construct uses.
    it('implements IConnectable for a Harness placed in a VPC', () => {
      expect(construct).toContain(
        "import * as ec2 from 'aws-cdk-lib/aws-ec2';",
      );
      expect(construct).toContain(
        'implements iam.IGrantable, ec2.IConnectable',
      );
      expect(construct).toContain(
        'public get connections(): ec2.Connections {',
      );

      // The three placement props, and a security group created only when the
      // caller does not bring their own.
      for (const prop of [
        'vpc?: ec2.IVpc;',
        'vpcSubnets?: ec2.SubnetSelection;',
        'securityGroups?: ec2.ISecurityGroup[];',
      ]) {
        expect(construct, prop).toContain(prop);
      }
      expect(construct).toContain(
        "new ec2.SecurityGroup(this, 'SecurityGroup'",
      );
      expect(construct).toContain('ec2.SubnetType.PRIVATE_WITH_EGRESS');

      // Rendered lazily, so a security group added through `connections` after
      // construction still reaches the resource.
      expect(construct).toContain('Lazy.any({');
      expect(construct).toContain("networkMode: 'VPC',");
    });
  });

  describe('Terraform iac', () => {
    /** The module as rendered for the default `packages/my-harness` root. */
    let tf: string;

    beforeEach(async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'terraform',
      });
      tf = tree.read(TF_MODULE_PATH, 'utf-8') ?? '';
    });

    it('emits the module, inlines the model id, and vends no CDK construct', () => {
      expect(tf).toContain('resource "aws_bedrockagentcore_harness" "this" {');
      expect(tf).toContain(
        'default     = "global.anthropic.claude-sonnet-4-6"',
      );
      // Read at plan time.
      expect(tf).toMatch(
        /system_prompt \{\s+text = file\("\$\{path\.module\}\//,
      );

      expect(tree.exists(CDK_CONSTRUCT_PATH)).toBe(false);
      expect(tree.exists(CDK_HARNESSES_INDEX_PATH)).toBe(false);
    });

    it('declares exactly the retained input variables', () => {
      // Set equality, so a variable added or removed here is deliberate. The
      // system prompt stays a file read rather than a variable.
      expect(
        [...tf.matchAll(/^variable "([a-z_]+)"/gm)].map(([, name]) => name),
      ).toEqual([
        'model_id',
        'allowed_tools',
        'memory',
        'environment_variables',
        'max_iterations',
        'timeout_seconds',
        'create_execution_role',
        'execution_role_arn',
        'model_resource_arns',
        'additional_execution_role_policy_statements',
        'enable_vpc',
        'vpc_id',
        'subnet_ids',
        'tags',
      ]);
      expect(tf).not.toContain('var.system_prompt');
    });

    it('defaults allowed_tools to none and always sends it', () => {
      // The service treats an absent allowed_tools as every tool, so the
      // module defaults to none and assigns the variable unconditionally.
      expect(tf).toMatch(
        /variable "allowed_tools" \{[^}]*type {8}= list\(string\)\n {2}default {5}= \[\]/,
      );
      expect(tf).toContain('allowed_tools         = var.allowed_tools');
    });

    it('cross-validates the variables that cannot be combined', () => {
      // enable_vpc needs both network inputs; a supplied role cannot be shaped
      // by the generated role's variables; memory takes exactly one form.
      expect(tf).toContain(
        'error_message = "vpc_id and subnet_ids must be set when enable_vpc is true."',
      );
      expect(tf).toContain(
        'error_message = "execution_role_arn must be set when create_execution_role is false."',
      );
      expect(tf).toContain(
        'error_message = "model_resource_arns and additional_execution_role_policy_statements configure the generated execution role, which is not created when create_execution_role is false. Grant those permissions on the supplied role instead."',
      );
      expect(tf).toContain(
        'error_message = "Set exactly one of memory.managed_memory_configuration, memory.agentcore_memory_configuration or memory.disabled."',
      );
    });

    it('creates the role and its baseline policy only when none is supplied', () => {
      // Counted off a plain input, not a computed value: a count derived from a
      // supplied ARN is unknown at plan time whenever that ARN is itself a
      // resource attribute, which fails the plan outright.
      for (const resource of [
        'resource "aws_iam_role" "execution_role"',
        'resource "aws_iam_role_policy" "execution_role"',
      ]) {
        expect(tf, resource).toContain(
          `${resource} {\n  count = var.create_execution_role ? 1 : 0`,
        );
      }
      // The harness and the output both follow whichever role is in use.
      expect(tf).toContain(
        'execution_role_arn = var.create_execution_role ? aws_iam_role.execution_role[0].arn : var.execution_role_arn',
      );
      expect(tf).toContain('execution_role_arn = local.execution_role_arn');
    });

    it('places the harness in a VPC only when enable_vpc is set', () => {
      // The security group and its egress rule are counted off enable_vpc, as
      // is the network configuration block.
      for (const resource of [
        'resource "aws_security_group" "harness"',
        'resource "aws_vpc_security_group_egress_rule" "harness_https"',
      ]) {
        expect(tf, resource).toContain(
          `${resource} {\n  count = var.enable_vpc ? 1 : 0`,
        );
      }
      // Egress is HTTPS only, to AWS service endpoints.
      expect(tf).toContain('from_port         = 443');
      expect(tf).toContain('to_port           = 443');

      expect(tf).toContain(
        'dynamic "environment" {\n    for_each = var.enable_vpc ? [1] : []',
      );
      expect(tf).toContain('network_mode = "VPC"');
      expect(tf).toContain(
        'security_groups = [aws_security_group.harness[0].id]',
      );

      // Exposed so resources the harness reaches can reference it.
      expect(tf).toContain(
        'value       = var.enable_vpc ? aws_security_group.harness[0].id : null',
      );
    });

    it('grants the private ECR pull VPC mode needs, and only then', () => {
      // In VPC mode the harness pulls its managed container from a private ECR
      // repository rather than ECR Public, so the role needs pull permissions
      // on it or sessions fail to start.
      expect(tf).toContain('var.enable_vpc ? [');
      expect(tf).toContain('Sid    = "EcrManagedImagePull"');
      expect(tf).toContain(
        'Resource = ["arn:${local.partition}:ecr:${local.region}:*:repository/harness-*"]',
      );
      expect(tf).toContain('Sid      = "EcrManagedImageToken"');

      // ECR Public remains the non-VPC path, so both stay.
      expect(tf).toContain('Sid      = "EcrPublicTokenAccess"');
    });

    it('justifies every wildcard IAM statement inline', () => {
      for (const skip of TF_CHECKOV_SKIPS) {
        expect(tf, skip).toContain(`#checkov:skip=${skip}`);
      }
      // Count too, so an unjustified statement cannot be added silently.
      expect(tf.match(/#checkov:skip=/g)).toHaveLength(TF_CHECKOV_SKIPS.length);
      expect(tf).not.toContain('Advanced extension region');
    });

    it.each([
      { label: 'an ordinary name', name: 'my-harness', prefix: 'MyHarness' },
      {
        label: 'a digit-leading name',
        name: '123-harness',
        prefix: 'H_123Harness',
      },
      {
        label: 'an over-long name',
        name: 'a-really-long-harness-name-that-exceeds-the-limit',
        prefix: 'AReallyLongHarnessNameThatExcee',
      },
      {
        label: 'an over-long digit-leading name',
        name: '1234567890-a-really-long-digit-leading-harness-name',
        prefix: 'H_1234567890AReallyLongDigitLea',
      },
    ])('interpolates the name prefix for $label', async ({ name, prefix }) => {
      const boundaryTree = createTreeUsingTsSolutionSetup();
      await agentcoreHarnessGenerator(boundaryTree, {
        name,
        iac: 'terraform',
      });
      const rendered =
        /harness_name_prefix = "([^"]*)"/.exec(
          boundaryTree.read(tfModulePath(name), 'utf-8') ?? '',
        )?.[1] ?? '';

      expect(rendered).toBe(prefix);
      // toClassName prefixes `_` for a digit-leading name, so the explicit `H`
      // must be applied before the truncation: a leading letter and a 31-char
      // cap keep `_<8 hex>` inside the 40-character AgentCore limit.
      expect(rendered).toMatch(/^[A-Za-z]/);
      expect(rendered.length).toBeLessThanOrEqual(31);
    });

    it('computes the name prefix in TypeScript, not HCL', () => {
      // A plain quoted literal: no interpolation or function call.
      expect(tf).toMatch(/harness_name_prefix = "[^"$]*"/);
      expect(tf).not.toContain('regexall(');
    });

    it('scopes the managed memory grant to the ARN the service assigns', () => {
      // The provider exposes the assigned ARN via memory_actual, so the grant
      // names the exact resource rather than guessing at its name.
      expect(tf).toContain(
        'Resource = [\n        aws_bedrockagentcore_harness.this.memory_actual[0].managed_memory_configuration[0].arn,',
      );
      expect(tf).not.toContain(':memory/');

      // Reading a deployed attribute means it cannot live in the baseline
      // policy, which the harness itself depends on.
      expect(tf).toContain('resource "aws_iam_role_policy" "managed_memory"');
      expect(tf).toContain(
        'count = var.create_execution_role && local.has_managed_memory ? 1 : 0',
      );
    });

    it('grants managed memory access only where it applies', () => {
      // Granted while the service provisions the memory; not for a memory
      // resource the user owns, nor when memory is off.
      expect(tf).toContain(
        'has_managed_memory = var.memory == null || var.memory.managed_memory_configuration != null',
      );

      // The baseline policy carries no memory statement of its own.
      const baseline = tf.slice(
        tf.indexOf('resource "aws_iam_role_policy" "execution_role"'),
        tf.indexOf('# Security group for the Harness'),
      );
      expect(baseline).not.toContain('AgentCoreManagedMemory');
    });
  });

  describe('idempotency and infra: none', () => {
    const CDK_OPTIONS: AgentcoreHarnessGeneratorSchema = {
      name: 'my-harness',
      iac: 'cdk',
    };
    const PROMPT_PATH = `${PROJECT_ROOT}/src/PROMPT.md`;

    /** The line addStarExport writes into the vended harnesses index. */
    const HARNESS_EXPORT_LINE = "export * from './my-harness/my-harness.js';";

    /**
     * Append a marker, keeping the edit format-stable: the generator formats
     * every file changed in the tree, so an edit biome would rewrite would
     * fail the comparison below for a reason that is not preservation.
     */
    const applyUserEdit = (path: string, marker: string) =>
      tree.write(path, `${tree.read(path, 'utf-8')}\n${marker}\n`);

    /** Full contents at edit time, which the re-run must leave alone. */
    const recordBytes = (paths: string[]) =>
      new Map(paths.map((path) => [path, tree.read(path, 'utf-8')]));

    const expectBytesPreserved = (recorded: Map<string, string | null>) => {
      for (const [path, contents] of recorded) {
        // Non-empty, so a path that was never written cannot pass vacuously.
        expect(contents, path).toBeTruthy();
        // Full-content equality against the recorded bytes. A `toContain`
        // marker check would still pass with KeepExisting dropped and the
        // rest of the file rewritten, so it is not preservation evidence.
        expect(tree.read(path, 'utf-8'), path).toBe(contents);
      }
    };

    const harnessExportLines = () =>
      (tree.read(CDK_HARNESSES_INDEX_PATH, 'utf-8') ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line === HARNESS_EXPORT_LINE);

    // KeepExisting and `??=` are the whole preservation guarantee.
    it('preserves an edited project file and vended construct byte-for-byte', async () => {
      await agentcoreHarnessGenerator(tree, CDK_OPTIONS);

      applyUserEdit(PROMPT_PATH, '## user edit');
      applyUserEdit(CDK_CONSTRUCT_PATH, '// user edit');
      const recorded = recordBytes([PROMPT_PATH, CDK_CONSTRUCT_PATH]);

      await agentcoreHarnessGenerator(tree, CDK_OPTIONS);

      expectBytesPreserved(recorded);
      // `??=` keeps a target the user owns, so the first-run contract still
      // holds exactly, and the wiring stays unique rather than duplicated.
      expect(readProjectConfiguration(tree, PROJECT_NAME).targets).toEqual({
        chat: CHAT_TARGET,
      });
      expect(harnessExportLines()).toEqual([HARNESS_EXPORT_LINE]);
    });

    it('restores exactly one harness export after the user deletes it', async () => {
      await agentcoreHarnessGenerator(tree, CDK_OPTIONS);
      expect(harnessExportLines()).toEqual([HARNESS_EXPORT_LINE]);

      tree.write(
        CDK_HARNESSES_INDEX_PATH,
        (tree.read(CDK_HARNESSES_INDEX_PATH, 'utf-8') ?? '')
          .split('\n')
          .filter((line) => line.trim() !== HARNESS_EXPORT_LINE)
          .join('\n'),
      );
      expect(harnessExportLines()).toEqual([]);

      await agentcoreHarnessGenerator(tree, CDK_OPTIONS);

      // Exactly one: neither left absent nor duplicated.
      expect(harnessExportLines()).toEqual([HARNESS_EXPORT_LINE]);
    });

    it('emits no infrastructure, then adds it on an infra: agentcore re-run', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'none',
      });

      const projectFiles = filesUnder(tree, PROJECT_ROOT);
      expect(projectFiles).toEqual([
        'README.md',
        'project.json',
        'scripts/chat.ts',
        'src/PROMPT.md',
      ]);
      // No construct, no Terraform module, and no vended index to export from.
      for (const path of [
        CDK_CONSTRUCT_PATH,
        CDK_HARNESSES_INDEX_PATH,
        CDK_APP_INDEX_PATH,
        TF_MODULE_PATH,
      ]) {
        expect(tree.exists(path), path).toBe(false);
      }

      // project.json is held out of the byte comparison: recording the newly
      // resolved provider is what the upgrade is for. Its targets and every
      // user-owned content file are still expected untouched.
      const recorded = recordBytes(
        projectFiles
          .filter((file) => file !== 'project.json')
          .map((file) => `${PROJECT_ROOT}/${file}`),
      );
      // An explicit iac is required: resolveIac throws on `inherit` without an
      // aws-nx-plugin.config.mts.
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        infra: 'agentcore',
        iac: 'cdk',
      });

      expect(tree.exists(CDK_CONSTRUCT_PATH)).toBe(true);
      expect(harnessExportLines()).toEqual([HARNESS_EXPORT_LINE]);
      expect(tree.read(CDK_APP_INDEX_PATH, 'utf-8')).toContain(
        "export * from './harnesses/index.js';",
      );
      // The upgrade adds infrastructure without disturbing the project.
      expectBytesPreserved(recorded);
      const upgraded = readProjectConfiguration(tree, PROJECT_NAME);
      expect(upgraded.targets).toEqual({ chat: CHAT_TARGET });
      // The sole project.json change is the provider the upgrade resolved.
      expect(upgraded.metadata as any).toEqual({
        generator: AGENTCORE_HARNESS_GENERATOR_INFO.id,
        name: 'my-harness',
        rc: 'MyHarness',
        auth: 'iam',
        iac: 'cdk',
      });
    });
  });

  describe('snapshot', () => {
    // The project directory only. The vended construct and Terraform module
    // stay out: they are long and churn for reasons unrelated to this
    // generator, so the blocks above cover them with targeted assertions.
    it('snapshots the four rendered harness project files', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });

      snapshotTreeDir(tree, PROJECT_ROOT);
    });
  });
});
