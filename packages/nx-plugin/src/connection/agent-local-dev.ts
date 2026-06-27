/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { applyGritQL } from '../utils/ast';
import {
  addDependencyToTargetIfNotPresent,
  type ComponentMetadata,
  readProjectConfigurationUnqualified,
} from '../utils/nx';

export interface AgentLocalDevOptions {
  agentNameClassName: string;
  port: number;
  targetComponent?: ComponentMetadata;
  /**
   * The runtime config namespace to set the local URL on.
   * E.g. 'apis' results in `runtimeConfig.apis.X = url`
   */
  runtimeConfigNamespace: string;
  /**
   * The local URL to set in the runtime config override.
   */
  localUrl: string;
  /**
   * Additional targets to add as dev dependencies.
   */
  additionalDependencyTargets?: string[];
}

/**
 * Adds a Strands Agent's component dev target as a dependency of the
 * source project's dev target, and updates the RuntimeConfig provider
 * to point to the agent's local URL.
 *
 * This is the shared implementation used by both Python and TypeScript Strands
 * Agent react-connection generators.
 */
export const addAgentTargetToLocalDev = async (
  tree: Tree,
  sourceProjectName: string,
  targetProjectName: string,
  options: AgentLocalDevOptions,
) => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    sourceProjectName,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    targetProjectName,
  );

  // Determine the dev target name for the agent component
  const agentDevTargetName = options.targetComponent?.name
    ? `${options.targetComponent.name}-dev`
    : 'agent-dev';

  // Target project must have the agent dev target which is continuous
  if (
    !(
      targetProject.targets?.[agentDevTargetName]?.continuous &&
      sourceProject.targets?.['dev']
    )
  ) {
    return;
  }

  // Add a dependency on the agent dev target (so that the agent's
  // own dev dependencies, such as MCP servers, are also started)
  addDependencyToTargetIfNotPresent(sourceProject, 'dev', {
    projects: [targetProject.name],
    target: agentDevTargetName,
  });
  for (const additional of options.additionalDependencyTargets ?? []) {
    addDependencyToTargetIfNotPresent(sourceProject, 'dev', additional);
  }
  updateProjectConfiguration(tree, sourceProject.name, sourceProject);

  // Add an override to runtime-config for the dev target to use the local url
  const runtimeConfigProvider = joinPathFragments(
    sourceProject.root,
    'src',
    'components',
    'RuntimeConfig',
    'index.tsx',
  );
  if (tree.exists(runtimeConfigProvider)) {
    await applyGritQL(
      tree,
      runtimeConfigProvider,
      `\`if ($cond) { $stmts }\` => raw\`if ($cond) {\n    $stmts\n    runtimeConfig.${options.runtimeConfigNamespace}.${options.agentNameClassName} = '${options.localUrl}';\n  }\` where { $cond <: contains \`'local-dev'\`, $stmts <: within \`const applyOverrides = $_\`, $stmts <: not contains \`runtimeConfig.${options.runtimeConfigNamespace}.${options.agentNameClassName}\` }`,
    );
  }
};
