/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, Tree } from '@nx/devkit';
import { applyGritQL, matchGritQL } from '../utils/ast';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../utils/shared-constructs-constants';

const CONNECTION_TF_MODULE_NAME =
  'add_agent_runtime_to_connection_runtime_config';

/**
 * Register the agent's runtime ARN in the 'connection' namespace so it is
 * published to the website's runtime-config.json. Patches the generated CDK
 * and Terraform constructs in-place; idempotent.
 *
 * Note: the 'connection' namespace is stage-scoped — every StaticWebsite in
 * the stage will see this ARN, not just the one the user connected.
 */
export const addAgentRuntimeToConnectionNamespace = async (
  tree: Tree,
  options: {
    /** The kebab-case directory name that holds the construct, e.g. 'story-agent'. */
    agentNameKebabCase: string;
    /** The class name of the agent, e.g. 'StoryAgent'. */
    agentNameClassName: string;
  },
) => {
  const cdkConstructPath = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
    'app',
    'agents',
    options.agentNameKebabCase,
    `${options.agentNameKebabCase}.ts`,
  );
  if (tree.exists(cdkConstructPath)) {
    await applyGritQL(
      tree,
      cdkConstructPath,
      `\`rc.set('agentcore', 'agentRuntimes', $args);\` => raw\`rc.set('agentcore', 'agentRuntimes', $args);

    rc.set('connection', 'agentRuntimes', {
      ...rc.get('connection').agentRuntimes,
      ${options.agentNameClassName}: this.agentCoreRuntime.agentRuntimeArn,
    });\` where { $program <: not contains \`rc.set('connection', 'agentRuntimes', $_)\` }`,
    );
  }

  const terraformConstructPath = joinPathFragments(
    PACKAGES_DIR,
    SHARED_TERRAFORM_DIR,
    'src',
    'app',
    'agents',
    options.agentNameKebabCase,
    `${options.agentNameKebabCase}.tf`,
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

# Also expose the agent runtime ARN to the frontend via the 'connection' namespace
module "${CONNECTION_TF_MODULE_NAME}" {
  source = "../../../core/runtime-config/entry"

  namespace = "connection"
  key       = "agentRuntimes"
  value     = { "${options.agentNameClassName}" = module.agent_core_runtime.agent_core_runtime_arn }

  depends_on = [module.agent_core_runtime]
}
`,
      );
    }
  }
};
