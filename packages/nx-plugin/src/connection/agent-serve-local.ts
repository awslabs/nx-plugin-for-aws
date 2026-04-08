/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { applyGritQL } from '../utils/ast';
import {
  ComponentMetadata,
  readProjectConfigurationUnqualified,
} from '../utils/nx';

export interface AgentServeLocalOptions {
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
   * Additional targets to add as serve-local dependencies.
   */
  additionalDependencyTargets?: string[];
}

/**
 * Adds a Strands Agent's component serve-local target as a dependency of the
 * source project's serve-local target, and updates the RuntimeConfig provider
 * to point to the agent's local URL.
 *
 * This is the shared implementation used by both Python and TypeScript Strands
 * Agent react-connection generators.
 */
export const addAgentTargetToServeLocal = async (
  tree: Tree,
  sourceProjectName: string,
  targetProjectName: string,
  options: AgentServeLocalOptions,
) => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    sourceProjectName,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    targetProjectName,
  );

  // Determine the serve-local target name for the agent component
  const agentServeLocalTargetName = options.targetComponent?.name
    ? `${options.targetComponent.name}-serve-local`
    : 'agent-serve-local';

  // Target project must have the agent serve-local target which is continuous
  if (
    !(
      targetProject.targets?.[agentServeLocalTargetName]?.continuous &&
      sourceProject.targets?.['serve-local']
    )
  ) {
    return;
  }

  // Add a dependency on the agent serve-local target (so that the agent's
  // own serve-local dependencies, such as MCP servers, are also started)
  sourceProject.targets['serve-local'].dependsOn = [
    ...(sourceProject.targets['serve-local'].dependsOn ?? []),
    {
      projects: [targetProject.name],
      target: agentServeLocalTargetName,
    },
    ...(options.additionalDependencyTargets ?? []),
  ];
  updateProjectConfiguration(tree, sourceProject.name, sourceProject);

  // Add an override to runtime-config for the serve-local target to use the local url
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
      `\`if ($cond) { $stmts }\` => raw\`if ($cond) {\n    $stmts\n    runtimeConfig.${options.runtimeConfigNamespace}.${options.agentNameClassName} = '${options.localUrl}';\n  }\` where { $cond <: contains \`'serve-local'\`, $stmts <: within \`const applyOverrides = $_\` }`,
    );
  }
};
