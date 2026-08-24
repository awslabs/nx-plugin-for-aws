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
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * Bring existing workspaces up to the generators' current gateway->agent
 * support for Cognito agents, which forward the caller's JWT to the runtime:
 *
 * - The vended `AgentCoreGateway` construct's `addAgent`/`addAgentTarget` pick
 *   the outbound credential from the agent's `auth`: a `cognito` agent uses
 *   `JWT_PASSTHROUGH` (the caller's token reaches the runtime), an `iam` agent
 *   the gateway role (`GATEWAY_IAM_ROLE`, the previous behaviour).
 * - Vended agent constructs gain an `auth` member `addAgent` reads, and Cognito
 *   agents allowlist the `Authorization` header (CDK + Terraform runtime) so the
 *   runtime receives the forwarded token.
 *
 * These files are generated with `KeepExisting`, so without this an upgraded
 * workspace pairs new app-level constructs with stale core ones. Diverged files
 * are left untouched and reported via `nextSteps`.
 */

const GATEWAY_CONSTRUCT_FILE = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/core/agentcore-gateway/agentcore-gateway.ts`;
const AGENTS_DIR = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src/app/agents`;
const TF_RUNTIME_FILE = `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}/src/core/agent-core/runtime.tf`;

/**
 * Teach the vended `AgentCoreGateway` construct to pick the target credential
 * from the agent's `auth` (JWT passthrough for Cognito, gateway role for IAM).
 */
const migrateGatewayConstruct = async (
  tree: Tree,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(GATEWAY_CONSTRUCT_FILE)) {
    return; // No vended gateway construct.
  }
  // Predates agent-target support (the gateway-agent-targets migration adds
  // addAgentTarget first) — match the method, not a bare identifier.
  if (
    !(await matchGritQL(
      tree,
      GATEWAY_CONSTRUCT_FILE,
      '`addAgentTarget(props: { $_ }): agentcore.CfnGatewayTarget { $_ }`',
    ))
  ) {
    return;
  }
  // Already migrated: the credentials member is on addAgentTarget's props.
  if (
    await matchGritQL(
      tree,
      GATEWAY_CONSTRUCT_FILE,
      "`credentials?: 'gateway-iam' | 'jwt-passthrough'`",
    )
  ) {
    return;
  }

  const divergedMessage = `In ${GATEWAY_CONSTRUCT_FILE}: have addAgent read the agent's \`auth\` and pass \`credentials: 'jwt-passthrough'\` to addAgentTarget, so the target's credentialProviderType becomes 'JWT_PASSTHROUGH' for Cognito agents.`;

  // GritQL patterns for each of the four edits. Verified against the tree
  // up-front so the transform is all-or-nothing: a construct missing any
  // anchor is left untouched with a single actionable next step, rather than
  // half-migrated.
  const authParamPattern = `\`readonly agentName: string\` as $sig where {
  $program <: not contains \`readonly auth?\`
} => \`$sig;
      readonly auth?: 'iam' | 'cognito'\``;

  const callPattern = `\`agentRuntimeArn: agent.agentCoreRuntime.agentRuntimeArn\` as $prop where {
  $program <: not contains \`credentials:\`
} => \`$prop,
      credentials: agent.auth === 'cognito' ? 'jwt-passthrough' : 'gateway-iam'\``;

  // The addAgentTarget props type: matched on its `agentRuntimeArn: string`
  // member signature (without trailing semicolon), which the rewrite re-adds
  // followed by the credentials member. The `: string` type distinguishes it
  // from the `agentRuntimeArn:` value in the addAgent call.
  const paramPattern = `\`agentRuntimeArn: string\` as $sig where {
  $program <: not contains \`credentials?\`
} => \`$sig;
    credentials?: 'gateway-iam' | 'jwt-passthrough'\``;

  // Scoped to the agent target's own CfnGatewayTarget (the one configured with
  // an agentcoreRuntime), so the MCP server target's GATEWAY_IAM_ROLE — a
  // sibling method with its own credential block — is left untouched.
  const credentialPattern = `\`credentialProviderType: 'GATEWAY_IAM_ROLE'\` as $cred where {
  $cred <: within \`new agentcore.CfnGatewayTarget($_, $_, $config)\`,
  $config <: contains \`agentcoreRuntime\`
} => \`credentialProviderType:
              props.credentials === 'jwt-passthrough'
                ? 'JWT_PASSTHROUGH'
                : 'GATEWAY_IAM_ROLE'\``;

  // Verify every anchor matches before mutating anything (matchGritQL is
  // read-only), so a diverged construct is never left partially migrated.
  for (const pattern of [
    authParamPattern,
    callPattern,
    paramPattern,
    credentialPattern,
  ]) {
    if (!(await matchGritQL(tree, GATEWAY_CONSTRUCT_FILE, pattern))) {
      nextSteps.push(divergedMessage);
      return;
    }
  }

  await applyGritQL(tree, GATEWAY_CONSTRUCT_FILE, authParamPattern);
  await applyGritQL(tree, GATEWAY_CONSTRUCT_FILE, callPattern);
  await applyGritQL(tree, GATEWAY_CONSTRUCT_FILE, paramPattern);
  await applyGritQL(tree, GATEWAY_CONSTRUCT_FILE, credentialPattern);
};

/**
 * Add the `auth` member to each vended agent construct, and for Cognito agents
 * allowlist the Authorization header so the runtime receives the forwarded JWT.
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
    // Only agents (which carry a gateway target name), not MCP servers.
    if (
      !(await matchGritQL(
        tree,
        constructFile,
        '`public readonly agentName = $_`',
      ))
    ) {
      continue;
    }
    if (await matchGritQL(tree, constructFile, '`public readonly auth = $_`')) {
      continue; // Already migrated (or user-added).
    }

    // Cognito agents configure the runtime's inbound authorizer with a Cognito
    // JWT — match that authorizerConfiguration property specifically.
    const isCognito = await matchGritQL(
      tree,
      constructFile,
      '`authorizerConfiguration: RuntimeAuthorizerConfiguration.usingCognito($_)`',
    );
    const authValue = isCognito ? 'cognito' : 'iam';

    // The `auth` member, after the agentName member. Matched without the
    // trailing semicolon — GritQL parses the field's initializer as its AST
    // node, so the semicolon is appended by the rewrite.
    const authPattern = `\`public readonly agentName = $name\` as $field => \`$field;
  /** Inbound auth — a fronting Gateway uses this to pick its outbound credential. */
  public readonly auth = '${authValue}'\``;

    // Cognito agents allowlist the Authorization header so the runtime (and a
    // fronting gateway, via passthrough) receives the caller's token.
    const headerNeeded =
      isCognito &&
      !(await matchGritQL(
        tree,
        constructFile,
        '`requestHeaderConfiguration: $_`',
      ));
    const headerPattern = `\`authorizerConfiguration: RuntimeAuthorizerConfiguration.usingCognito($args)\` as $authz where {
  $program <: not contains \`requestHeaderConfiguration\`
} => \`$authz,
      ${GRIT_INSERT_PLACEHOLDER}\``;
    const headerText = `// Receive the caller's Authorization header (validated by the authorizer).
      requestHeaderConfiguration: {
        allowlistedHeaders: ['Authorization'],
      }`;

    // Verify every anchor up-front so the construct is never half-migrated:
    // if any edit can't be applied, leave the file untouched with one
    // actionable next step.
    const authOk = await matchGritQL(tree, constructFile, authPattern);
    const headerOk =
      !headerNeeded || (await matchGritQL(tree, constructFile, headerPattern));
    if (!authOk || !headerOk) {
      const actions = [
        `add a \`public readonly auth = '${authValue}';\` member`,
      ];
      if (headerNeeded) {
        actions.push(
          `add \`requestHeaderConfiguration: { allowlistedHeaders: ['Authorization'] }\` to its Runtime so a gateway can pass the caller's JWT through`,
        );
      }
      nextSteps.push(`In ${constructFile}: ${actions.join('; and ')}.`);
      continue;
    }

    await applyGritQL(tree, constructFile, authPattern);
    if (headerNeeded) {
      await insertViaGritQL(tree, constructFile, headerPattern, headerText);
    }
  }
};

/**
 * Add the `request_header_configuration` block to the vended Terraform runtime
 * module so a JWT-authorized runtime receives the forwarded Authorization
 * header (the analogue of the CDK requestHeaderConfiguration).
 */
const migrateTerraformRuntime = async (
  tree: Tree,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(TF_RUNTIME_FILE)) {
    return;
  }
  if (
    await matchGritQL(
      tree,
      TF_RUNTIME_FILE,
      'language hcl\n`dynamic "request_header_configuration" { $_ }`',
    )
  ) {
    return; // Already migrated.
  }

  const tfActionMessage = `In ${TF_RUNTIME_FILE}: add a \`request_header_configuration { request_header_allowlist = ["Authorization"] }\` block (guarded by the JWT authorizer) to the aws_bedrockagentcore_agent_runtime resource so a gateway can pass the caller's JWT through.`;

  const hasAuthorizerBlock = await matchGritQL(
    tree,
    TF_RUNTIME_FILE,
    'language hcl\n`dynamic "authorizer_configuration" { $_ }`',
  );
  if (!hasAuthorizerBlock) {
    nextSteps.push(tfActionMessage);
    return;
  }

  const added = await insertViaGritQL(
    tree,
    TF_RUNTIME_FILE,
    `language hcl
\`dynamic "authorizer_configuration" { $body }\` as $block where {
  $block <: within \`resource "aws_bedrockagentcore_agent_runtime" $_ { $_ }\`
} => \`$block

  ${GRIT_INSERT_PLACEHOLDER}\``,
    `# Receive the caller's Authorization header (validated by the JWT authorizer).
  dynamic "request_header_configuration" {
    for_each = var.authorizer_configuration != null && try(var.authorizer_configuration.custom_jwt_authorizer, null) != null ? [1] : []
    content {
      request_header_allowlist = ["Authorization"]
    }
  }`,
  );
  if (!added) {
    nextSteps.push(tfActionMessage);
  }
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  await migrateGatewayConstruct(tree, nextSteps);
  await migrateAgentConstructs(tree, nextSteps);
  await migrateTerraformRuntime(tree, nextSteps);

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
