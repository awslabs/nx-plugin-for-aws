/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const GATEWAY_CONSTRUCT_FILE =
  'packages/common/constructs/src/core/agentcore-gateway/agentcore-gateway.ts';
const COGNITO_AGENT_FILE =
  'packages/common/constructs/src/app/agents/my-cognito-agent/my-cognito-agent.ts';
const IAM_AGENT_FILE =
  'packages/common/constructs/src/app/agents/my-iam-agent/my-iam-agent.ts';
const TF_RUNTIME_FILE =
  'packages/common/terraform/src/core/agent-core/runtime.tf';

/**
 * The `AgentCoreGateway` construct as generated with agent-target support but
 * before Cognito JWT passthrough — condensed to the shapes the migration edits:
 * the addAgent param, the addAgent->addAgentTarget call, the addAgentTarget
 * signature, and the target credential provider.
 */
const OLD_GATEWAY_CONSTRUCT = `import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export class AgentCoreGateway extends Construct implements iam.IGrantable {
  public addAgent(
    agent: Construct & {
      readonly agentCoreRuntime: agentcore.Runtime;
      readonly agentName: string;
    },
    props?: {
      gatewayTargetName?: string;
    },
  ): agentcore.CfnGatewayTarget {
    return this.addAgentTarget({
      gatewayTargetName: props?.gatewayTargetName ?? agent.agentName,
      agentRuntimeArn: agent.agentCoreRuntime.agentRuntimeArn,
    });
  }

  public addAgentTarget(props: {
    gatewayTargetName: string;
    agentRuntimeArn: string;
  }): agentcore.CfnGatewayTarget {
    const target = new agentcore.CfnGatewayTarget(this, \`Target-\${props.gatewayTargetName}\`, {
      gatewayIdentifier: this.gateway.gatewayId,
      name: props.gatewayTargetName,
      targetConfiguration: {
        http: { agentcoreRuntime: { arn: props.agentRuntimeArn, qualifier: 'DEFAULT' } },
      },
        // The bare gateway IAM role credential: runtime targets reject the
        // iamCredentialProvider detail MCP targets carry.
        credentialProviderConfigurations: [
          {
            credentialProviderType: 'GATEWAY_IAM_ROLE',
          },
        ],
    });
    return target;
  }

  public addMcpServerTarget(props: {
    gatewayTargetName: string;
    mcpServerRuntimeArn: string;
  }): agentcore.CfnGatewayTarget {
    const target = new agentcore.CfnGatewayTarget(this, \`Target-\${props.gatewayTargetName}\`, {
      gatewayIdentifier: this.gateway.gatewayId,
      name: props.gatewayTargetName,
      targetConfiguration: {
        mcp: { openApiSchema: { inlinePayload: 'x' } },
      },
        credentialProviderConfigurations: [
          {
            credentialProviderType: 'GATEWAY_IAM_ROLE',
            credentialProvider: {
              iamCredentialProvider: { service: 'bedrock-agentcore' },
            },
          },
        ],
    });
    return target;
  }
}
`;

/** A Cognito agent construct before the migration: no `auth`, no header allowlist. */
const OLD_COGNITO_AGENT = `import { Runtime, RuntimeAuthorizerConfiguration } from 'aws-cdk-lib/aws-bedrockagentcore';
import { Construct } from 'constructs';

export class MyCognitoAgent extends Construct {
  public readonly agentCoreRuntime: Runtime;
  /** Default Gateway target name for this agent. */
  public readonly agentName = 'my-cognito-agent';

  constructor(scope: Construct, id: string, props: MyCognitoAgentProps) {
    super(scope, id);
    const { identity } = props;
    this.agentCoreRuntime = new Runtime(this, 'MyCognitoAgent', {
      authorizerConfiguration: RuntimeAuthorizerConfiguration.usingCognito(
        identity.userPool,
        [identity.userPoolClient],
      ),
    });
  }
}
`;

/** An IAM agent construct before the migration: no `auth` member. */
const OLD_IAM_AGENT = `import { Runtime } from 'aws-cdk-lib/aws-bedrockagentcore';
import { Construct } from 'constructs';

export class MyIamAgent extends Construct {
  public readonly agentCoreRuntime: Runtime;
  /** Default Gateway target name for this agent. */
  public readonly agentName = 'my-iam-agent';

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.agentCoreRuntime = new Runtime(this, 'MyIamAgent', {});
  }
}
`;

/** The Terraform runtime module before the migration: JWT authorizer, no header config. */
const OLD_TF_RUNTIME = `resource "aws_bedrockagentcore_agent_runtime" "agent_runtime" {
  agent_runtime_name = "test"

  dynamic "authorizer_configuration" {
    for_each = var.authorizer_configuration != null && try(var.authorizer_configuration.custom_jwt_authorizer, null) != null ? [var.authorizer_configuration.custom_jwt_authorizer] : []
    content {
      custom_jwt_authorizer {
        discovery_url    = authorizer_configuration.value.discovery_url
        allowed_audience = authorizer_configuration.value.allowed_audience
        allowed_clients  = authorizer_configuration.value.allowed_clients
      }
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }
}
`;

describe('gateway-cognito-passthrough migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const seedGateway = () =>
    tree.write(GATEWAY_CONSTRUCT_FILE, OLD_GATEWAY_CONSTRUCT);
  const seedCognitoAgent = () =>
    tree.write(COGNITO_AGENT_FILE, OLD_COGNITO_AGENT);
  const seedIamAgent = () => tree.write(IAM_AGENT_FILE, OLD_IAM_AGENT);
  const seedTfRuntime = () => tree.write(TF_RUNTIME_FILE, OLD_TF_RUNTIME);

  it('does nothing when no gateway, agent or terraform runtime is vended', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('makes the gateway pick the target credential from the agent auth', async () => {
    seedGateway();
    const result = await migration(tree);
    const contents = tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8')!;

    expect(contents).toContain(`readonly auth?: 'iam' | 'cognito';`);
    expect(contents).toContain(
      `credentials: agent.auth === 'cognito' ? 'jwt-passthrough' : 'gateway-iam',`,
    );
    expect(contents).toContain(
      `credentials?: 'gateway-iam' | 'jwt-passthrough';`,
    );
    expect(contents).toContain(`? 'JWT_PASSTHROUGH'`);
    expect(contents).toContain(`: 'GATEWAY_IAM_ROLE'`);
    // Only the agent target's credential becomes conditional — the MCP server
    // target keeps its unconditional GATEWAY_IAM_ROLE.
    expect(contents).toContain(`credentialProviderType: 'GATEWAY_IAM_ROLE',
            credentialProvider: {`);
    // Exactly one conditional (agent) credential provider.
    expect(
      contents.match(/props\.credentials === 'jwt-passthrough'/g),
    ).toHaveLength(1);
    expect(result.nextSteps).toEqual([]);
    expect(contents).toMatchSnapshot();
  });

  it('adds auth=cognito and the Authorization allowlist to a Cognito agent', async () => {
    seedCognitoAgent();
    const result = await migration(tree);
    const contents = tree.read(COGNITO_AGENT_FILE, 'utf-8')!;

    expect(contents).toContain(`public readonly auth = 'cognito';`);
    expect(contents).toContain(`allowlistedHeaders: ['Authorization'],`);
    expect(result.nextSteps).toEqual([]);
    expect(contents).toMatchSnapshot();
  });

  it('adds auth=iam (no header allowlist) to an IAM agent', async () => {
    seedIamAgent();
    const result = await migration(tree);
    const contents = tree.read(IAM_AGENT_FILE, 'utf-8')!;

    expect(contents).toContain(`public readonly auth = 'iam';`);
    expect(contents).not.toContain('requestHeaderConfiguration');
    expect(result.nextSteps).toEqual([]);
  });

  it('adds the request_header_configuration block to the terraform runtime', async () => {
    seedTfRuntime();
    const result = await migration(tree);
    const contents = tree.read(TF_RUNTIME_FILE, 'utf-8')!;

    expect(contents).toContain('dynamic "request_header_configuration"');
    expect(contents).toContain('request_header_allowlist = ["Authorization"]');
    expect(result.nextSteps).toEqual([]);
    expect(contents).toMatchSnapshot();
  });

  it('is idempotent', async () => {
    seedGateway();
    seedCognitoAgent();
    seedIamAgent();
    seedTfRuntime();

    await migration(tree);
    const gatewayAfterFirst = tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8');
    const cognitoAfterFirst = tree.read(COGNITO_AGENT_FILE, 'utf-8');
    const tfAfterFirst = tree.read(TF_RUNTIME_FILE, 'utf-8');

    const secondRun = await migration(tree);

    expect(tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8')).toEqual(
      gatewayAfterFirst,
    );
    expect(tree.read(COGNITO_AGENT_FILE, 'utf-8')).toEqual(cognitoAfterFirst);
    expect(tree.read(TF_RUNTIME_FILE, 'utf-8')).toEqual(tfAfterFirst);
    expect(secondRun.nextSteps).toEqual([]);
  });

  it('skips and reports a diverged gateway construct', async () => {
    // A real addAgentTarget method (so agent-target support is detected), but
    // the user has customised the body away from the generated shape — the
    // credential-provider anchor is gone — so the migration must not touch it.
    tree.write(
      GATEWAY_CONSTRUCT_FILE,
      `import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore';

export class AgentCoreGateway {
  public addAgentTarget(props: {
    gatewayTargetName: string;
    agentRuntimeArn: string;
  }): agentcore.CfnGatewayTarget {
    // diverged: custom implementation, no recognisable credential block
    return this.buildCustomTarget(props);
  }
}
`,
    );
    const before = tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8');
    const result = await migration(tree);
    // Left untouched, with a single actionable next step.
    expect(tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8')).toEqual(before);
    expect(result.nextSteps).toEqual([
      expect.stringContaining("pass `credentials: 'jwt-passthrough'`"),
    ]);
  });

  it('leaves an agent construct with a user-added auth member alone', async () => {
    tree.write(
      IAM_AGENT_FILE,
      OLD_IAM_AGENT.replace(
        `  public readonly agentName = 'my-iam-agent';`,
        `  public readonly agentName = 'my-iam-agent';
  public readonly auth = 'iam';`,
      ),
    );
    const before = tree.read(IAM_AGENT_FILE, 'utf-8');
    const result = await migration(tree);
    expect(tree.read(IAM_AGENT_FILE, 'utf-8')).toEqual(before);
    expect(result.nextSteps).toEqual([]);
  });
});
