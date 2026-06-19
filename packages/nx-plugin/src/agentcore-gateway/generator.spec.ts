/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { expectHasMetricTags } from '../utils/metrics.spec';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import {
  AGENTCORE_GATEWAY_GENERATOR_INFO,
  agentcoreGatewayGenerator,
} from './generator';

describe('agentcore-gateway generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('common behaviour', () => {
    it('scaffolds the project with policies and a serve-local aggregator', async () => {
      await agentcoreGatewayGenerator(tree, {
        name: 'my-gateway',
        iac: 'cdk',
      });

      expect(tree.exists('packages/my-gateway/project.json')).toBe(true);
      expect(tree.exists('packages/my-gateway/policies/permit-all.cedar')).toBe(
        true,
      );
      expect(tree.exists('packages/my-gateway/policies/README.md')).toBe(true);
      expect(tree.exists('packages/my-gateway/serve-local.ts')).toBe(true);

      const config = readProjectConfiguration(tree, '@proj/my-gateway');
      // Both `serve` and `serve-local` exist as continuous keep-alive
      // aggregators — they chain `dependsOn` onto attached MCP servers'
      // real serve targets and hold them open. They must be continuous (not
      // `nx:noop`) so that when this aggregator is itself a dependency of an
      // agent's continuous `serve-local`, Nx does not consider it "done" and
      // tear down its continuous MCP-server dependencies.
      for (const target of ['my-gateway-serve', 'my-gateway-serve-local']) {
        expect(config.targets?.[target]).toBeDefined();
        expect(config.targets?.[target].executor).toBe('nx:run-commands');
        expect(config.targets?.[target].continuous).toBe(true);
        expect(config.targets?.[target].options.command).toBe(
          'tsx serve-local.ts',
        );
      }
    });

    it('registers project metadata with rc/protocol/auth fields', async () => {
      await agentcoreGatewayGenerator(tree, {
        name: 'my-gateway',
        iac: 'cdk',
      });

      const config = readProjectConfiguration(tree, '@proj/my-gateway');
      expect(config.metadata as any).toMatchObject({
        generator: AGENTCORE_GATEWAY_GENERATOR_INFO.id,
        name: 'my-gateway',
        rc: 'MyGateway',
        protocol: 'mcp',
        auth: 'iam',
      });
    });

    it('adds generator metric tags', async () => {
      await agentcoreGatewayGenerator(tree, {
        name: 'my-gateway',
        iac: 'cdk',
      });
      expectHasMetricTags(tree, AGENTCORE_GATEWAY_GENERATOR_INFO.metric);
    });

    it('accepts a custom project directory and subDirectory', async () => {
      await agentcoreGatewayGenerator(tree, {
        name: 'my-gateway',
        directory: 'apps',
        subDirectory: 'gateways/my-gateway',
        iac: 'cdk',
      });

      expect(tree.exists('apps/gateways/my-gateway/project.json')).toBe(true);
      expect(
        tree.exists('apps/gateways/my-gateway/policies/permit-all.cedar'),
      ).toBe(true);
    });

    it('is idempotent: re-running preserves user policies and serve-local wiring', async () => {
      await agentcoreGatewayGenerator(tree, {
        name: 'my-gateway',
        iac: 'cdk',
      });

      // Simulate user edits + connection wiring between runs.
      tree.write(
        'packages/my-gateway/policies/custom.cedar',
        'permit (principal, action, resource);',
      );
      tree.write(
        'packages/my-gateway/policies/permit-all.cedar',
        '// user-edited',
      );
      const config = readProjectConfiguration(tree, '@proj/my-gateway');
      config.targets!['my-gateway-serve-local'].dependsOn = [
        { projects: ['@proj/some-mcp'], target: 'some-mcp-serve-local' },
      ];
      const { updateProjectConfiguration } = await import('@nx/devkit');
      updateProjectConfiguration(tree, '@proj/my-gateway', config);

      await agentcoreGatewayGenerator(tree, {
        name: 'my-gateway',
        iac: 'cdk',
      });

      expect(tree.exists('packages/my-gateway/policies/custom.cedar')).toBe(
        true,
      );
      expect(
        tree.read('packages/my-gateway/policies/permit-all.cedar')!.toString(),
      ).toContain('user-edited');
      const rerunConfig = readProjectConfiguration(tree, '@proj/my-gateway');
      expect(
        rerunConfig.targets?.['my-gateway-serve-local'].dependsOn,
      ).toContainEqual(
        expect.objectContaining({ target: 'some-mcp-serve-local' }),
      );
      // Project metadata is unchanged on re-run
      expect((rerunConfig.metadata as any).generator).toBe(
        AGENTCORE_GATEWAY_GENERATOR_INFO.id,
      );
    });

    it('supports a gateway named "gateway" — vended class must not clash with CDK imports', async () => {
      await agentcoreGatewayGenerator(tree, {
        name: 'gateway',
        iac: 'cdk',
      });

      const construct = tree
        .read('packages/common/constructs/src/app/gateways/gateway/gateway.ts')!
        .toString();
      expect(construct).toContain(
        'export class Gateway extends AgentCoreGateway',
      );
      // The shared construct references the CDK Gateway class via a
      // namespace so a vended `Gateway` class does not collide with it.
      const core = tree
        .read(
          'packages/common/constructs/src/core/agentcore-gateway/agentcore-gateway.ts',
        )!
        .toString();
      expect(core).toContain('new agentcore.Gateway(');
      expect(core).not.toMatch(/import \{[^}]*\bGateway\b[^}]*\} from/);
    });

    it('kebab-cases class-style names and pascal-cases runtime config keys', async () => {
      await agentcoreGatewayGenerator(tree, {
        name: 'ShopFront Gateway',
        iac: 'cdk',
      });

      const config = readProjectConfiguration(tree, '@proj/shop-front-gateway');
      const metadata = config.metadata as any;
      expect(metadata.name).toBe('shop-front-gateway');
      expect(metadata.rc).toBe('ShopFrontGateway');
      expect(config.targets?.['shop-front-gateway-serve-local']).toBeDefined();
    });
  });

  describe('CDK iac', () => {
    beforeEach(async () => {
      await agentcoreGatewayGenerator(tree, {
        name: 'my-gateway',
        iac: 'cdk',
      });
    });

    it('emits the CDK construct into shared-constructs', () => {
      expect(
        tree.exists(
          'packages/common/constructs/src/app/gateways/my-gateway/my-gateway.ts',
        ),
      ).toBe(true);
      expect(
        tree.exists('packages/common/constructs/src/app/gateways/index.ts'),
      ).toBe(true);
    });

    it('wires the MCP-protocol Gateway with IAM inbound auth + ENFORCE policy engine', () => {
      const construct = tree
        .read(
          'packages/common/constructs/src/core/agentcore-gateway/agentcore-gateway.ts',
        )!
        .toString();
      expect(construct).toContain(
        'protocolConfiguration: new agentcore.McpProtocolConfiguration',
      );
      expect(construct).toContain(
        'authorizerConfiguration: agentcore.GatewayAuthorizer.usingAwsIam()',
      );
      expect(construct).toContain("mode: 'ENFORCE'");
      const app = tree
        .read(
          'packages/common/constructs/src/app/gateways/my-gateway/my-gateway.ts',
        )!
        .toString();
      expect(app).toContain('class MyGateway extends AgentCoreGateway');
      expect(app).toContain('cedarPolicyPath');
    });

    it('uses only stable aws-cdk-lib modules — no alpha imports, no bare-named CDK imports', () => {
      const construct = tree
        .read(
          'packages/common/constructs/src/core/agentcore-gateway/agentcore-gateway.ts',
        )!
        .toString();
      expect(construct).not.toContain('@aws-cdk/aws-bedrock-agentcore-alpha');
      // Namespace imports avoid clashes between the CDK `Gateway` class and a
      // vended gateway class named `Gateway` (a gateway generated as "gateway")
      expect(construct).toContain(
        "import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore'",
      );
      expect(construct).not.toMatch(/import \{[^}]*\bGateway\b[^}]*\} from/);
    });

    it('uses IAM SigV4 outbound (iamCredentialProvider) for MCP server targets', () => {
      const construct = tree
        .read(
          'packages/common/constructs/src/core/agentcore-gateway/agentcore-gateway.ts',
        )!
        .toString();
      expect(construct).toContain('iamCredentialProvider');
      expect(construct).toContain("service: 'bedrock-agentcore'");
    });

    it('grants the gateway role policy evaluation permissions', () => {
      const construct = tree
        .read(
          'packages/common/constructs/src/core/agentcore-gateway/agentcore-gateway.ts',
        )!
        .toString();
      expect(construct).toContain('bedrock-agentcore:AuthorizeAction');
      expect(construct).toContain(
        'bedrock-agentcore:CheckAuthorizePermissions',
      );
    });

    it('registers the gateway URL in runtime config at agentcore.gateways.<ClassName>', () => {
      const construct = tree
        .read(
          'packages/common/constructs/src/app/gateways/my-gateway/my-gateway.ts',
        )!
        .toString();
      expect(construct).toContain("rc.set('agentcore', 'gateways'");
      expect(construct).toContain('MyGateway: this.gateway.gatewayUrl');
    });

    it('exposes grantInvokeAccess + addMcpServerTarget public methods', () => {
      const construct = tree
        .read(
          'packages/common/constructs/src/core/agentcore-gateway/agentcore-gateway.ts',
        )!
        .toString();
      expect(construct).toContain('public grantInvokeAccess');
      expect(construct).toContain('public addMcpServerTarget');
    });

    it('exposes addGateway + addGatewayTarget for gateway-to-gateway composition', () => {
      const construct = tree
        .read(
          'packages/common/constructs/src/core/agentcore-gateway/agentcore-gateway.ts',
        )!
        .toString();
      expect(construct).toContain('public addGateway');
      expect(construct).toContain('public addGatewayTarget');
      // The source gateway's role needs InvokeGateway on the target gateway
      // to fetch tools at target creation time and route calls at runtime.
      expect(construct).toContain('bedrock-agentcore:InvokeGateway');
      // The vended app construct exposes the default gateway target name
      // used by addGateway.
      const app = tree
        .read(
          'packages/common/constructs/src/app/gateways/my-gateway/my-gateway.ts',
        )!
        .toString();
      expect(app).toContain("public readonly gatewayName = 'my-gateway'");
    });

    it('derives the gateway target construct id from the target name as Target-<name>', () => {
      const construct = tree
        .read(
          'packages/common/constructs/src/core/agentcore-gateway/agentcore-gateway.ts',
        )!
        .toString();
      // Construct ids preserve the kebab-case target name (e.g. `ts-mcp` ->
      // `Target-ts-mcp`) so the id changes with the target name.
      expect(construct).toContain('`Target-${gatewayTargetName}`');
      expect(construct).not.toContain('toPascalCase');
    });

    it('URL-encodes the runtime ARN correctly for the MCP target endpoint', () => {
      const construct = tree
        .read(
          'packages/common/constructs/src/core/agentcore-gateway/agentcore-gateway.ts',
        )!
        .toString();
      // Both ':' and '/' must be encoded in the path segment of the
      // AgentCore Runtime invocation URL. We do this with nested
      // Fn.join/Fn.split at synth time because the ARN is a CDK token.
      expect(construct).toContain("'%3A'");
      expect(construct).toContain("'%2F'");
      expect(construct).toContain('Fn.split');
      expect(construct).toContain('Fn.join');
    });
  });

  describe('Terraform iac', () => {
    beforeEach(async () => {
      await agentcoreGatewayGenerator(tree, {
        name: 'my-gateway',
        iac: 'terraform',
      });
    });

    it('emits the app-level Terraform module', () => {
      expect(
        tree.exists(
          'packages/common/terraform/src/app/gateways/my-gateway/my-gateway.tf',
        ),
      ).toBe(true);
    });

    it('emits the shared core-level agentcore-gateway Terraform module', () => {
      // The exact file name comes from the core template directory we emit.
      const coreFiles = tree.children(
        'packages/common/terraform/src/core/agentcore-gateway',
      );
      expect(coreFiles.length).toBeGreaterThan(0);
    });

    it('does not emit the CDK construct when iac is terraform', () => {
      expect(
        tree.exists(
          'packages/common/constructs/src/app/gateways/my-gateway/my-gateway.ts',
        ),
      ).toBe(false);
    });

    it('renders Cedar policies via the ejs render script', () => {
      expect(
        tree.exists(
          'packages/common/terraform/src/app/gateways/my-gateway/render-cedar.cjs',
        ),
      ).toBe(true);
      const module = tree
        .read(
          'packages/common/terraform/src/app/gateways/my-gateway/my-gateway.tf',
        )!
        .toString();
      expect(module).toContain('data "external" "rendered_policies"');
      expect(module).toContain('render-cedar.cjs');
    });

    it('emits a tool_dependencies-gated readiness probe routed through gateway_url', () => {
      const module = tree
        .read(
          'packages/common/terraform/src/app/gateways/my-gateway/my-gateway.tf',
        )!
        .toString();
      // The probe only runs when this gateway is aggregated by another.
      expect(module).toContain('variable "tool_dependencies"');
      expect(module).toContain('resource "null_resource" "gateway_ready"');
      expect(module).toContain(
        'count = length(var.tool_dependencies) > 0 ? 1 : 0',
      );
      // gateway_url flows through the probe so consumers wait for readiness.
      expect(module).toContain(
        'null_resource.gateway_ready[0].triggers.gateway_url',
      );
    });
  });

  describe('Cedar policy templates', () => {
    beforeEach(async () => {
      await agentcoreGatewayGenerator(tree, {
        name: 'my-gateway',
        iac: 'cdk',
      });
    });

    it('ships a permit-all.cedar scoped to the gateway ARN via ejs tokens', () => {
      const permitAll = tree
        .read('packages/my-gateway/policies/permit-all.cedar')!
        .toString();
      expect(permitAll).toMatch(/permit\s*\(/);
      expect(permitAll).toContain('<%= gatewayArn %>');
      expect(permitAll).toContain('AgentCore::Gateway');
    });

    it('includes a policies README describing conventions and ENFORCE mode', () => {
      const readme = tree
        .read('packages/my-gateway/policies/README.md')!
        .toString();
      expect(readme).toContain('ENFORCE');
      expect(readme.toLowerCase()).toContain('cedar');
    });
  });

  describe('cedarPolicy: false', () => {
    beforeEach(async () => {
      await agentcoreGatewayGenerator(tree, {
        name: 'my-gateway',
        iac: 'cdk',
        cedarPolicy: false,
      });
    });

    it('omits the policies directory', () => {
      expect(tree.exists('packages/my-gateway/policies')).toBe(false);
      expect(tree.exists('packages/my-gateway/serve-local.ts')).toBe(true);
    });

    it('omits the cedar policy path from the CDK construct', () => {
      const construct = tree
        .read(
          'packages/common/constructs/src/app/gateways/my-gateway/my-gateway.ts',
        )!
        .toString();
      expect(construct).not.toContain('cedarPolicyPath');
      expect(construct).toContain('extends AgentCoreGateway');
    });
  });

  describe('cedarPolicy: false (terraform)', () => {
    it('omits the policy engine and render script from the terraform module', async () => {
      await agentcoreGatewayGenerator(tree, {
        name: 'my-gateway',
        iac: 'terraform',
        cedarPolicy: false,
      });
      const module = tree
        .read(
          'packages/common/terraform/src/app/gateways/my-gateway/my-gateway.tf',
        )!
        .toString();
      expect(module).not.toContain('policy_engine');
      expect(module).not.toContain('render-cedar');
      expect(module).toContain('aws_bedrockagentcore_gateway');
      expect(
        tree.exists(
          'packages/common/terraform/src/app/gateways/my-gateway/render-cedar.cjs',
        ),
      ).toBe(false);
    });
  });

  describe('infra: none', () => {
    it('skips all infrastructure, then adds it on re-run with infra=agentcore', async () => {
      await agentcoreGatewayGenerator(tree, {
        name: 'my-gateway',
        iac: 'cdk',
        infra: 'none',
      });

      expect(tree.exists('packages/my-gateway/serve-local.ts')).toBe(true);
      expect(
        tree.exists(
          'packages/common/constructs/src/app/gateways/my-gateway/my-gateway.ts',
        ),
      ).toBe(false);

      // Upgrade: re-run with infra=agentcore vends the construct
      await agentcoreGatewayGenerator(tree, {
        name: 'my-gateway',
        iac: 'cdk',
        infra: 'agentcore',
      });
      expect(
        tree.exists(
          'packages/common/constructs/src/app/gateways/my-gateway/my-gateway.ts',
        ),
      ).toBe(true);
      // Project metadata is intact after the upgrade
      const config = readProjectConfiguration(tree, '@proj/my-gateway');
      expect((config.metadata as any).generator).toBe(
        AGENTCORE_GATEWAY_GENERATOR_INFO.id,
      );
    });
  });
});
