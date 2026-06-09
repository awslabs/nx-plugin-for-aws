/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import {
  AGENTCORE_GATEWAY_GENERATOR_INFO,
  agentcoreGatewayGenerator,
} from './generator';

describe('cedar#agentcore-gateway generator', () => {
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

      const config = readProjectConfiguration(tree, '@proj/my-gateway');
      // Both `serve` and `serve-local` exist as continuous keep-alive
      // aggregators — they chain `dependsOn` onto attached MCP servers'
      // real serve targets and hold them open. They must be continuous (not
      // `nx:noop`) so that when this aggregator is itself a dependency of an
      // agent's continuous `serve-local`, Nx does not consider it "done" and
      // tear down its continuous MCP-server dependencies.
      expect(config.targets?.['my-gateway-serve']).toBeDefined();
      expect(config.targets?.['my-gateway-serve'].executor).toBe(
        'nx:run-commands',
      );
      expect(config.targets?.['my-gateway-serve'].continuous).toBe(true);
      expect(config.targets?.['my-gateway-serve-local']).toBeDefined();
      expect(config.targets?.['my-gateway-serve-local'].executor).toBe(
        'nx:run-commands',
      );
      expect(config.targets?.['my-gateway-serve-local'].continuous).toBe(true);
    });

    it('registers component metadata with rc/protocol/auth fields', async () => {
      await agentcoreGatewayGenerator(tree, {
        name: 'my-gateway',
        iac: 'cdk',
      });

      const config = readProjectConfiguration(tree, '@proj/my-gateway');
      expect((config.metadata as any).components).toHaveLength(1);
      expect((config.metadata as any).components[0]).toMatchObject({
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
      // Component metadata is not duplicated on re-run
      expect((rerunConfig.metadata as any).components).toHaveLength(1);
    });

    it('kebab-cases class-style names and pascal-cases runtime config keys', async () => {
      await agentcoreGatewayGenerator(tree, {
        name: 'ShopFront Gateway',
        iac: 'cdk',
      });

      const config = readProjectConfiguration(tree, '@proj/shop-front-gateway');
      const component = (config.metadata as any).components[0];
      expect(component.name).toBe('shop-front-gateway');
      expect(component.rc).toBe('ShopFrontGateway');
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
          'packages/common/constructs/src/app/gateways/my-gateway/my-gateway.ts',
        )!
        .toString();
      expect(construct).toContain('class MyGateway');
      expect(construct).toContain(
        'protocolConfiguration: new McpProtocolConfiguration',
      );
      expect(construct).toContain(
        'authorizerConfiguration: GatewayAuthorizer.usingAwsIam()',
      );
      expect(construct).toContain('PolicyEngineMode.ENFORCE');
    });

    it('uses IAM SigV4 outbound (iamCredentialProvider) for MCP server targets', () => {
      const construct = tree
        .read(
          'packages/common/constructs/src/app/gateways/my-gateway/my-gateway.ts',
        )!
        .toString();
      expect(construct).toContain('iamCredentialProvider');
      expect(construct).toContain("service: 'bedrock-agentcore'");
    });

    it('includes the CheckAuthorizePermissions workaround until the alpha L2 adds it', () => {
      const construct = tree
        .read(
          'packages/common/constructs/src/app/gateways/my-gateway/my-gateway.ts',
        )!
        .toString();
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
          'packages/common/constructs/src/app/gateways/my-gateway/my-gateway.ts',
        )!
        .toString();
      expect(construct).toContain('public grantInvokeAccess');
      expect(construct).toContain('public addMcpServerTarget');
    });

    it('URL-encodes the runtime ARN correctly for the MCP target endpoint', () => {
      const construct = tree
        .read(
          'packages/common/constructs/src/app/gateways/my-gateway/my-gateway.ts',
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
  });

  describe('Cedar policy templates', () => {
    beforeEach(async () => {
      await agentcoreGatewayGenerator(tree, {
        name: 'my-gateway',
        iac: 'cdk',
      });
    });

    it('ships a permit-all.cedar scoped to the gateway ARN via token substitution', () => {
      const permitAll = tree
        .read('packages/my-gateway/policies/permit-all.cedar')!
        .toString();
      expect(permitAll).toMatch(/permit\s*\(/);
      expect(permitAll).toContain('${gateway_arn}');
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
});
