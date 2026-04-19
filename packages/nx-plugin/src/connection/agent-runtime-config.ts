/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, Tree } from '@nx/devkit';
import { applyGritQL } from '../utils/ast';
import { kebabCase } from '../utils/names';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../utils/shared-constructs-constants';

/**
 * Patches the generated agent-core CDK construct to additionally register
 * the agent's runtime ARN under the 'connection' namespace, making it
 * available in the static website's runtime-config.json.
 *
 * The construct is generated once by the agent generator and typically not
 * modified by users, so the AST transform is stable. The construct
 * unconditionally registers the ARN under the 'agentcore' namespace; this
 * function adds a sibling `rc.set('connection', ...)` call.
 *
 * Note: the 'connection' namespace is stage-scoped by the RuntimeConfig
 * singleton — every StaticWebsite in the same stage will therefore see this
 * agent's ARN in its runtime-config.json, not just the website the user
 * connected. If we later need per-website filtering we'll need to re-introduce
 * an allow-list on the StaticWebsite construct.
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
  const constructFilePath = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
    'app',
    'agents',
    options.agentNameKebabCase,
    `${options.agentNameKebabCase}.ts`,
  );

  if (!tree.exists(constructFilePath)) {
    return;
  }

  // Append a sibling `rc.set('connection', ...)` call right after the existing
  // `rc.set('agentcore', 'agentRuntimes', ...)` call. Guarded against
  // double-application via a `not contains` constraint on the program.
  await applyGritQL(
    tree,
    constructFilePath,
    `\`rc.set('agentcore', 'agentRuntimes', $args);\` => raw\`rc.set('agentcore', 'agentRuntimes', $args);

    rc.set('connection', 'agentRuntimes', {
      ...rc.get('connection').agentRuntimes,
      ${options.agentNameClassName}: this.agentCoreRuntime.agentRuntimeArn,
    });\` where { $program <: not contains \`rc.set('connection', 'agentRuntimes', $_)\` }`,
  );
};

/**
 * Derive the construct directory (kebab-case) from the agent's class name.
 * Mirrors the `name = kebabCase(options.name || defaultName)` -> `agentNameClassName = toClassName(name)`
 * transformation used by the agent generators.
 */
export const agentConstructDirFromClassName = (
  agentNameClassName: string,
): string => kebabCase(agentNameClassName);
