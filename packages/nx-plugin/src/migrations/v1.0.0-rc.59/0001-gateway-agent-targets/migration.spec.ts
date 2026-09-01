/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const GATEWAY_CONSTRUCT_FILE =
  'packages/common/constructs/src/core/agentcore-gateway/agentcore-gateway.ts';

const AGENT_CONSTRUCT_FILE =
  'packages/common/constructs/src/app/agents/my-agent/my-agent.ts';

/**
 * The `AgentCoreGateway` core construct as generated prior to agent runtime
 * target support, condensed to the shapes the migration anchors on: the props
 * interface, the class fields, the constructor's Gateway creation, and the
 * target methods.
 */
const OLD_GATEWAY_CONSTRUCT_FILE = `import * as cdk from 'aws-cdk-lib';
import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as triggers from 'aws-cdk-lib/triggers';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import { Construct } from 'constructs';

export interface AgentCoreGatewayProps {
  readonly cedarPolicyPath?: string;
  readonly cedarPolicyVariables?: Record<string, string>;
  readonly enableWaf?: boolean;
  readonly authorizer?: agentcore.IGatewayAuthorizerConfig;
}

export class AgentCoreGateway extends Construct implements iam.IGrantable {
  public readonly gateway: agentcore.Gateway;
  public readonly policyEngine?: agentcore.CfnPolicyEngine;
  public readonly webAcl?: wafv2.CfnWebACL;
  private readonly policies: agentcore.CfnPolicy[] = [];
  private targetReadinessProbe?: triggers.TriggerFunction;
  private readonly targetRuntimeArns: string[] = [];

  constructor(scope: Construct, id: string, props?: AgentCoreGatewayProps) {
    super(scope, id);

    this.gateway = new agentcore.Gateway(this, 'Gateway', {
      gatewayName: cdk.Names.uniqueResourceName(this, { maxLength: 39 }),
      protocolConfiguration: new agentcore.McpProtocolConfiguration({
        searchType: agentcore.McpGatewaySearchType.SEMANTIC,
        supportedVersions: [agentcore.MCPProtocolVersion.MCP_2025_03_26],
      }),
      authorizerConfiguration:
        props?.authorizer ?? agentcore.GatewayAuthorizer.usingAwsIam(),
    });
  }

  public get grantPrincipal(): iam.IPrincipal {
    return this.gateway.role.grantPrincipal;
  }

  public addGatewayTarget(props: {
    gatewayTargetName: string;
    gatewayUrl: string;
    gatewayArn: string;
  }): agentcore.CfnGatewayTarget {
    const target = this.addTarget(props.gatewayTargetName, props.gatewayUrl);

    const grant = this.gateway.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock-agentcore:InvokeGateway'],
        resources: [props.gatewayArn],
      }),
    );
    if (grant.policyDependable) {
      target.node.addDependency(grant.policyDependable);
    }

    return target;
  }

  private addTarget(
    gatewayTargetName: string,
    endpoint: string,
  ): agentcore.CfnGatewayTarget {
    const target = new agentcore.CfnGatewayTarget(
      this,
      \`Target-\${gatewayTargetName}\`,
      {
        gatewayIdentifier: this.gateway.gatewayId,
        name: gatewayTargetName,
        targetConfiguration: {
          mcp: {
            mcpServer: {
              endpoint,
            },
          },
        },
      },
    );

    for (const policy of this.policies) {
      policy.node.addDependency(target);
    }

    return target;
  }
}
`;

/**
 * A vended agent construct as generated prior to the `agentName` member,
 * condensed to the field the migration anchors on.
 */
const OLD_AGENT_CONSTRUCT_FILE = `import {
  AgentRuntimeArtifact,
  ProtocolType,
  Runtime,
} from 'aws-cdk-lib/aws-bedrockagentcore';
import { Construct } from 'constructs';

export class MyAgent extends Construct {
  public readonly dockerImage: AgentRuntimeArtifact;
  public readonly agentCoreRuntime: Runtime;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.agentCoreRuntime = undefined as any;
  }
}
`;

describe('gateway-agent-targets migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should do nothing when no gateway or agent constructs are vended', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('should add the protocol prop and agent target methods to the vended gateway construct', async () => {
    tree.write(GATEWAY_CONSTRUCT_FILE, OLD_GATEWAY_CONSTRUCT_FILE);

    const result = await migration(tree);

    const contents = tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8');
    expect(contents).toContain(`readonly protocol?: 'mcp' | 'http';`);
    expect(contents).toContain(`private readonly protocol: 'mcp' | 'http';`);
    expect(contents).toContain(`this.protocol = props?.protocol ?? 'mcp';`);
    expect(contents).toContain(
      `cfnGateway.addPropertyDeletionOverride('ProtocolType');`,
    );
    expect(contents).toContain('public addAgent(');
    expect(contents).toContain('public addAgentTarget(props: {');
    expect(contents).toContain('agentcoreRuntime');
    // A cleanly-applied transform reports nothing — nextSteps is for manual
    // follow-up actions only.
    expect(result.nextSteps).toEqual([]);
    expect(contents).toMatchSnapshot();
  });

  it('should add the agentName member to vended agent constructs', async () => {
    tree.write(AGENT_CONSTRUCT_FILE, OLD_AGENT_CONSTRUCT_FILE);

    await migration(tree);

    const contents = tree.read(AGENT_CONSTRUCT_FILE, 'utf-8');
    expect(contents).toContain(`public readonly agentName = 'my-agent';`);
    expect(contents).toMatchSnapshot();
  });

  it('should be idempotent', async () => {
    tree.write(GATEWAY_CONSTRUCT_FILE, OLD_GATEWAY_CONSTRUCT_FILE);
    tree.write(AGENT_CONSTRUCT_FILE, OLD_AGENT_CONSTRUCT_FILE);

    await migration(tree);
    const gatewayAfterFirst = tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8');
    const agentAfterFirst = tree.read(AGENT_CONSTRUCT_FILE, 'utf-8');

    const secondRun = await migration(tree);

    expect(tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8')).toEqual(
      gatewayAfterFirst,
    );
    expect(tree.read(AGENT_CONSTRUCT_FILE, 'utf-8')).toEqual(agentAfterFirst);
    expect(secondRun.nextSteps).toEqual([]);
  });

  it('should skip and report a diverged gateway construct', async () => {
    tree.write(
      GATEWAY_CONSTRUCT_FILE,
      `export class AgentCoreGateway { /* fully customised */ }`,
    );

    const result = await migration(tree);

    expect(tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8')).toContain(
      'fully customised',
    );
    expect(result.nextSteps).toEqual([
      expect.stringContaining('diverged from the generated shape'),
    ]);
  });

  it('should skip and report a diverged agent construct', async () => {
    tree.write(
      AGENT_CONSTRUCT_FILE,
      `export class MyAgent { /* fully customised */ }`,
    );

    const result = await migration(tree);

    expect(tree.read(AGENT_CONSTRUCT_FILE, 'utf-8')).toContain(
      'fully customised',
    );
    expect(result.nextSteps).toEqual([
      expect.stringContaining('diverged from the generated shape'),
    ]);
  });

  it('should leave an agent construct with a user-added agentName alone', async () => {
    const withAgentName = OLD_AGENT_CONSTRUCT_FILE.replace(
      'public readonly agentCoreRuntime: Runtime;',
      `public readonly agentCoreRuntime: Runtime;\n  public readonly agentName = 'custom-name';`,
    );
    tree.write(AGENT_CONSTRUCT_FILE, withAgentName);

    const result = await migration(tree);

    expect(tree.read(AGENT_CONSTRUCT_FILE, 'utf-8')).toContain('custom-name');
    expect(
      tree.read(AGENT_CONSTRUCT_FILE, 'utf-8').match(/agentName/g),
    ).toHaveLength(1);
    expect(result.nextSteps).toEqual([]);
  });
});
