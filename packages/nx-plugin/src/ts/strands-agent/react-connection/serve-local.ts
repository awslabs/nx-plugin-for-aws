/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { applyGritQL } from '../../../utils/ast';
import {
  ComponentMetadata,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';

export interface StrandsAgentServeLocalOptions {
  agentName: string;
  agentNameClassName: string;
  port: number;
  targetComponent?: ComponentMetadata;
}

/**
 * Adds the given strands agent target project to the source project's serve-local target
 * Updates the runtime config provider (if it exists) to point to the local WebSocket URL
 */
export const addStrandsAgentTargetToServeLocal = async (
  tree: Tree,
  sourceProjectName: string,
  targetProjectName: string,
  options: StrandsAgentServeLocalOptions,
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
  ];
  updateProjectConfiguration(tree, sourceProject.name, sourceProject);

  // Add an override to runtime-config for the serve-local target to use the local WebSocket url
  const runtimeConfigProvider = joinPathFragments(
    sourceProject.root,
    'src',
    'components',
    'RuntimeConfig',
    'index.tsx',
  );
  if (tree.exists(runtimeConfigProvider)) {
    const localUrl = `ws://localhost:${options.port}/ws`;
    await applyGritQL(
      tree,
      runtimeConfigProvider,
      `\`if ($cond) { $stmts }\` => raw\`if ($cond) {\n    $stmts\n    runtimeConfig.agentRuntimes.${options.agentNameClassName} = '${localUrl}';\n  }\` where { $cond <: contains \`'serve-local'\`, $stmts <: within \`const applyOverrides = $_\` }`,
    );
  }
};
