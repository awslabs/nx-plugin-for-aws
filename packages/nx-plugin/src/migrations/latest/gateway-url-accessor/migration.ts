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
 * The CDK `Gateway` L2 types its `gatewayUrl` as `string | undefined`, so
 * reaching through the vended `AgentCoreGateway` construct to
 * `gateway.gateway.gatewayUrl` does not typecheck where a `string` is required —
 * the DCR proxy's `upstreamUrl`, for example. `AgentCoreGateway` gains a
 * non-optional `gatewayUrl` accessor falling back to the CloudFormation
 * attribute, which `addGateway` and the vended app-level gateway constructs then
 * read.
 */

const CONSTRUCTS_SRC = `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}/src`;

const GATEWAY_CONSTRUCT_FILE = `${CONSTRUCTS_SRC}/core/agentcore-gateway/agentcore-gateway.ts`;

const GATEWAYS_DIR = `${CONSTRUCTS_SRC}/app/gateways`;

const GATEWAY_URL_ACCESSOR = `/**
   * The gateway's URL endpoint. The Gateway L2 types its own \`gatewayUrl\` as
   * optional and only populates it when created from its own props, so fall
   * back to the CloudFormation attribute.
   */
  public get gatewayUrl(): string {
    return (
      this.gateway.gatewayUrl ??
      (this.gateway.node.defaultChild as agentcore.CfnGateway).attrGatewayUrl
    );
  }`;

const divergedCoreMessage = `${GATEWAY_CONSTRUCT_FILE}: the AgentCoreGateway construct has diverged from the generated shape - left untouched. To use a gateway's URL where a \`string\` is required, add a \`public get gatewayUrl(): string\` accessor returning \`this.gateway.gatewayUrl ?? (this.gateway.node.defaultChild as agentcore.CfnGateway).attrGatewayUrl\`.`;

/**
 * Add the `gatewayUrl` accessor to the vended core construct, and route
 * `addGateway` and the shape it requires of its argument through it. Returns
 * whether the core construct ends up carrying the accessor — app-level
 * constructs may only be pointed at it once it exists.
 */
const migrateCoreConstruct = async (
  tree: Tree,
  nextSteps: string[],
): Promise<boolean> => {
  if (!tree.exists(GATEWAY_CONSTRUCT_FILE)) {
    return false;
  }

  const hasAccessor = await matchGritQL(
    tree,
    GATEWAY_CONSTRUCT_FILE,
    '`public get gatewayUrl(): string { $_ }`',
  );

  if (!hasAccessor) {
    // Anchored on the grantPrincipal accessor, present in every vended version.
    const added = await insertViaGritQL(
      tree,
      GATEWAY_CONSTRUCT_FILE,
      `\`public get grantPrincipal(): iam.IPrincipal { $body }\` as $accessor => \`$accessor

  ${GRIT_INSERT_PLACEHOLDER}\``,
      GATEWAY_URL_ACCESSOR,
    );
    if (!added) {
      nextSteps.push(divergedCoreMessage);
      return false;
    }
  }

  const addGatewayUsesAccessor = await matchGritQL(
    tree,
    GATEWAY_CONSTRUCT_FILE,
    '`gatewayUrl: gateway.gatewayUrl`',
  );

  if (!addGatewayUsesAccessor) {
    // The accessor is part of the shape addGateway requires of its argument.
    await applyGritQL(
      tree,
      GATEWAY_CONSTRUCT_FILE,
      `\`readonly gatewayName: string\` as $member => \`$member;
      readonly gatewayUrl: string\``,
    );

    // addGateway reads the accessor rather than repeating the fallback inline.
    await applyGritQL(
      tree,
      GATEWAY_CONSTRUCT_FILE,
      `\`this.addGatewayTarget({ gatewayTargetName: $name, gatewayUrl: $url, gatewayArn: $arn })\` where {
  $url <: contains \`attrGatewayUrl\`
} => \`this.addGatewayTarget({
      gatewayTargetName: $name,
      gatewayUrl: gateway.gatewayUrl,
      gatewayArn: $arn,
    })\``,
    );
  }

  return true;
};

/**
 * Point each vended app-level gateway construct's runtime config entry at the
 * accessor.
 */
const migrateAppConstructs = async (tree: Tree): Promise<void> => {
  if (!tree.exists(GATEWAYS_DIR)) {
    return;
  }
  for (const dir of tree.children(GATEWAYS_DIR)) {
    const constructFile = `${GATEWAYS_DIR}/${dir}/${dir}.ts`;
    if (!tree.exists(constructFile)) {
      continue;
    }
    await applyGritQL(
      tree,
      constructFile,
      '`this.gateway.gatewayUrl` => `this.gatewayUrl`',
    );
  }
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  // The app constructs read the accessor, so they may only be migrated once the
  // core construct carries it.
  if (await migrateCoreConstruct(tree, nextSteps)) {
    await migrateAppConstructs(tree);
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
