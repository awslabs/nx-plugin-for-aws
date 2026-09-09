/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, type Tree } from '@nx/devkit';
import { applyGritQL, matchGritQL } from '../utils/ast.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../utils/shared-constructs-constants.js';

const CONNECTION_TF_MODULE_NAME =
  'add_gateway_url_to_connection_runtime_config';

/**
 * Register the gateway's URL in the 'connection' namespace so it is published
 * to the website's runtime-config.json. Patches the generated CDK and
 * Terraform constructs in-place; idempotent.
 *
 * Note: the 'connection' namespace is stage-scoped — every StaticWebsite in
 * the stage will see this URL, not just the one the user connected.
 */
export const addGatewayUrlToConnectionNamespace = async (
  tree: Tree,
  options: {
    /** The kebab-case directory name that holds the construct, e.g. 'my-gateway'. */
    gatewayNameKebabCase: string;
    /** The class name of the gateway, e.g. 'MyGateway'. */
    gatewayNameClassName: string;
  },
) => {
  const cdkConstructPath = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
    'app',
    'gateways',
    options.gatewayNameKebabCase,
    `${options.gatewayNameKebabCase}.ts`,
  );
  if (tree.exists(cdkConstructPath)) {
    await applyGritQL(
      tree,
      cdkConstructPath,
      `\`rc.set('agentcore', 'gateways', $args);\` => raw\`rc.set('agentcore', 'gateways', $args);

    rc.set('connection', 'gateways', {
      ...rc.get('connection').gateways,
      ${options.gatewayNameClassName}: this.gatewayUrl,
    });\` where { $program <: not contains \`rc.set('connection', 'gateways', $_)\` }`,
    );
  }

  const terraformConstructPath = joinPathFragments(
    PACKAGES_DIR,
    SHARED_TERRAFORM_DIR,
    'src',
    'app',
    'gateways',
    options.gatewayNameKebabCase,
    `${options.gatewayNameKebabCase}.tf`,
  );
  if (tree.exists(terraformConstructPath)) {
    const alreadyPatched = await matchGritQL(
      tree,
      terraformConstructPath,
      `language hcl\n\`module "${CONNECTION_TF_MODULE_NAME}" { $_ }\``,
    );
    if (!alreadyPatched) {
      const source = tree.read(terraformConstructPath, 'utf-8')!;
      tree.write(
        terraformConstructPath,
        `${source.trimEnd()}

# Also expose the gateway URL to the frontend via the 'connection' namespace
module "${CONNECTION_TF_MODULE_NAME}" {
  source = "../../../core/runtime-config/entry"

  namespace = "connection"
  key       = "gateways"
  value     = { "${options.gatewayNameClassName}" = aws_bedrockagentcore_gateway.this.gateway_url }

  depends_on = [aws_bedrockagentcore_gateway.this]
}
`,
      );
    }
  }
};
