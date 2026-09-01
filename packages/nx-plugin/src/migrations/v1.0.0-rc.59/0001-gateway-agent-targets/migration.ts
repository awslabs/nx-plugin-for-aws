/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MigrationReturnObject, Tree } from '@nx/devkit';
import {
  applyGritQL,
  GRIT_INSERT_PLACEHOLDER,
  insertViaGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * Bring existing workspaces up to the generators' current gateway-target
 * support, so agents can be attached to an http-protocol AgentCore Gateway:
 *
 * - The vended `AgentCoreGateway` core construct gains the `protocol` prop
 *   (http gateways have no protocol type, which AgentCore Runtime targets
 *   require) and the `addAgent` / `addAgentTarget` methods.
 * - Vended agent constructs gain the `agentName` member `addAgent` reads as
 *   the default gateway target name.
 *
 * Both files are generated with `KeepExisting`, so without this an upgraded
 * workspace pairs new app-level constructs with stale core ones.
 */

const GATEWAY_CONSTRUCT_FILE = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/core/agentcore-gateway/agentcore-gateway.ts`;

const AGENTS_DIR = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/app/agents`;

const PROTOCOL_PROP = `/**
   * The gateway's protocol. An \`mcp\` gateway aggregates MCP server targets
   * into a single MCP endpoint. An \`http\` gateway has no protocol type and
   * proxies requests to AgentCore Runtime targets via path-based routing
   * (\`/<targetName>/invocations\`) — the target type AgentCore only allows on
   * gateways without a protocol type.
   *
   * @default 'mcp'
   */
  readonly protocol?: 'mcp' | 'http';`;

const PROTOCOL_CONSTRUCTOR_STATEMENTS = `this.protocol = props?.protocol ?? 'mcp';
`;

const PROTOCOL_TYPE_REMOVAL = `
    if (this.protocol === 'http') {
      // AgentCore Runtime targets require a gateway without a protocol type,
      // which the Gateway L2 cannot express — it always renders MCP — so
      // remove the protocol from the underlying CloudFormation resource.
      const cfnGateway = this.gateway.node.defaultChild as agentcore.CfnGateway;
      cfnGateway.addPropertyDeletionOverride('ProtocolType');
      cfnGateway.addPropertyDeletionOverride('ProtocolConfiguration');
    }`;

const AGENT_TARGET_METHODS = `
  /**
   * Add an agent runtime construct as a target of this Gateway. Requires the
   * \`http\` protocol — the gateway proxies requests for the agent under
   * \`<gatewayUrl>/<targetName>/invocations\`, without protocol translation.
   *
   * The target name defaults to the agent construct's \`agentName\` (its
   * project's class name in kebab-case, e.g. \`MyAgent\` -> \`my-agent\`). It
   * forms the target's invocation path, so renaming it later is a breaking
   * change for consumers.
   */
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

  /**
   * Register an agent runtime ARN as a Gateway target. Prefer
   * {@link addAgent} when the construct is in scope.
   */
  public addAgentTarget(props: {
    gatewayTargetName: string;
    agentRuntimeArn: string;
  }): agentcore.CfnGatewayTarget {
    if (this.protocol !== 'http') {
      throw new Error(
        \`Agent runtime targets require an http-protocol gateway, but this gateway uses '\${this.protocol}'.\`,
      );
    }

    // The construct id is derived from the target name so the two change
    // together — target names are unique per gateway, and replacing a target
    // under an unchanged name fails with AlreadyExists.
    const target = new agentcore.CfnGatewayTarget(
      this,
      \`Target-\${props.gatewayTargetName}\`,
      {
        gatewayIdentifier: this.gateway.gatewayId,
        name: props.gatewayTargetName,
        targetConfiguration: {
          http: {
            agentcoreRuntime: {
              arn: props.agentRuntimeArn,
              qualifier: 'DEFAULT',
            },
          },
        },
        // The bare gateway IAM role credential: runtime targets reject the
        // iamCredentialProvider detail MCP targets carry.
        credentialProviderConfigurations: [
          {
            credentialProviderType: 'GATEWAY_IAM_ROLE',
          },
        ],
      },
    );

    // Grant the gateway role invoke access to the target runtime before the
    // target is created — AgentCore validates access to the runtime during
    // target creation.
    const grant = this.gateway.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock-agentcore:InvokeAgentRuntime',
          'bedrock-agentcore:InvokeAgentRuntimeWithWebSocketStream',
          // A2A targets additionally serve their agent card via the gateway.
          'bedrock-agentcore:GetAgentCard',
        ],
        resources: [props.agentRuntimeArn, \`\${props.agentRuntimeArn}/*\`],
      }),
    );
    if (grant.policyDependable) {
      target.node.addDependency(grant.policyDependable);
    }

    return target;
  }`;

/**
 * Add the `protocol` prop, its constructor handling and the agent-target
 * methods to the vended `AgentCoreGateway` core construct.
 */
const migrateGatewayConstruct = async (
  tree: Tree,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(GATEWAY_CONSTRUCT_FILE)) {
    // No vended gateway construct in this workspace - nothing to migrate.
    return;
  }

  if (
    (tree.read(GATEWAY_CONSTRUCT_FILE, 'utf-8') ?? '').includes(
      'addAgentTarget',
    )
  ) {
    // Already migrated.
    return;
  }

  const divergedMessage = `${GATEWAY_CONSTRUCT_FILE}: the AgentCoreGateway construct has diverged from the generated shape - left untouched. Re-run the agentcore-gateway generator in a fresh workspace to see the current construct, which supports agent runtime targets via a 'protocol' prop and addAgent()/addAgentTarget() methods.`;

  // Anchored on the shapes every vended version of the construct carries: the
  // props interface, the class field the protocol field is inserted after,
  // and the Gateway creation in the constructor.
  const hasVendedShape =
    (await matchGritQL(
      tree,
      GATEWAY_CONSTRUCT_FILE,
      '`export interface AgentCoreGatewayProps { $_ }`',
    )) &&
    (await matchGritQL(
      tree,
      GATEWAY_CONSTRUCT_FILE,
      '`private readonly targetRuntimeArns: string[] = []`',
    )) &&
    (await matchGritQL(
      tree,
      GATEWAY_CONSTRUCT_FILE,
      "`this.gateway = new agentcore.Gateway(this, 'Gateway', $_)`",
    ));

  if (!hasVendedShape) {
    nextSteps.push(divergedMessage);
    return;
  }

  // 1. The protocol prop on AgentCoreGatewayProps. The placeholder keeps the
  //    prop's doc comment (with its backticks) out of the GritQL pattern.
  await insertViaGritQL(
    tree,
    GATEWAY_CONSTRUCT_FILE,
    `\`export interface AgentCoreGatewayProps { $members }\` where {
  $members <: not contains \`protocol\`
} => \`export interface AgentCoreGatewayProps { $members
  ${GRIT_INSERT_PLACEHOLDER}
}\``,
    PROTOCOL_PROP,
  );

  // 2. The protocol class field. Matched without the trailing semicolon —
  //    GritQL parses the snippet standalone, where the semicolon is not part
  //    of the field's AST node.
  await applyGritQL(
    tree,
    GATEWAY_CONSTRUCT_FILE,
    `\`private readonly targetRuntimeArns: string[] = []\` as $field where {
  $program <: not contains \`private readonly protocol\`
} => \`$field;
  private readonly protocol: 'mcp' | 'http'\``,
  );

  // 3. Assign the field and remove the protocol type for http gateways.
  await insertViaGritQL(
    tree,
    GATEWAY_CONSTRUCT_FILE,
    `\`this.gateway = new agentcore.Gateway($args);\` as $stmt where {
  $program <: not contains \`this.protocol = props\`
} => \`${GRIT_INSERT_PLACEHOLDER}
    $stmt\``,
    PROTOCOL_CONSTRUCTOR_STATEMENTS,
  );
  await insertViaGritQL(
    tree,
    GATEWAY_CONSTRUCT_FILE,
    `\`this.gateway = new agentcore.Gateway($args);\` as $stmt where {
  $program <: not contains \`addPropertyDeletionOverride\`
} => \`$stmt
${GRIT_INSERT_PLACEHOLDER}\``,
    PROTOCOL_TYPE_REMOVAL,
  );

  // 4. The agent-target methods, inserted after addGatewayTarget (present in
  //    every vended version that also has the readiness probe field).
  const addedMethods = await insertViaGritQL(
    tree,
    GATEWAY_CONSTRUCT_FILE,
    `\`public addGatewayTarget($params): agentcore.CfnGatewayTarget { $body }\` as $method where {
  $program <: not contains \`addAgentTarget\`
} => \`$method
${GRIT_INSERT_PLACEHOLDER}\``,
    AGENT_TARGET_METHODS,
  );

  if (!addedMethods) {
    nextSteps.push(divergedMessage);
    return;
  }
};

/**
 * Add the `agentName` member to each vended agent construct, which
 * `AgentCoreGateway.addAgent` reads as the default gateway target name.
 */
const migrateAgentConstructs = async (
  tree: Tree,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(AGENTS_DIR)) {
    return;
  }
  for (const dir of tree.children(AGENTS_DIR)) {
    const constructFile = `${AGENTS_DIR}/${dir}/${dir}.ts`;
    if (!tree.exists(constructFile)) {
      continue;
    }
    if ((tree.read(constructFile, 'utf-8') ?? '').includes('agentName')) {
      // Already migrated (or user-added).
      continue;
    }
    const added = await insertViaGritQL(
      tree,
      constructFile,
      `\`public readonly agentCoreRuntime: Runtime\` as $field => \`$field;
  ${GRIT_INSERT_PLACEHOLDER}\``,
      `/** Default Gateway target name for this agent. */
  public readonly agentName = '${dir}'`,
    );
    if (!added) {
      nextSteps.push(
        `${constructFile}: the agent construct has diverged from the generated shape - left untouched. To attach this agent to a gateway with addAgent(), add a \`public readonly agentName = '${dir}';\` member (or use addAgentTarget() with an explicit target name).`,
      );
    }
  }
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  await migrateGatewayConstruct(tree, nextSteps);
  await migrateAgentConstructs(tree, nextSteps);

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
