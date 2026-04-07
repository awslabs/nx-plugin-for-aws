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
import { kebabCase } from '../../../utils/names';

export interface PyStrandsAgentServeLocalOptions {
  agentName: string;
  agentNameClassName: string;
  port: number;
  targetComponent?: ComponentMetadata;
}

/**
 * Adds the given py strands agent target project to the source project's serve-local target.
 * Updates the runtime config provider (if it exists) to point to the local HTTP URL.
 * Also adds dependencies on the OpenAPI client generation targets so that local
 * API changes are reflected in the generated client.
 */
export const addPyStrandsAgentTargetToServeLocal = async (
  tree: Tree,
  sourceProjectName: string,
  targetProjectName: string,
  options: PyStrandsAgentServeLocalOptions,
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

  // Determine the client generation target names
  const clientGenTarget = `generate:${kebabCase(options.agentNameClassName)}-client`;
  const clientGenWatchTarget = `watch-${clientGenTarget}`;

  // Add a dependency on the agent serve-local target (so that the agent's
  // own serve-local dependencies, such as MCP servers, are also started),
  // along with the client generation targets
  sourceProject.targets['serve-local'].dependsOn = [
    ...(sourceProject.targets['serve-local'].dependsOn ?? []).filter(
      (dep: any) =>
        // Remove any existing serve-local dep added by addOpenApiReactClient's
        // addTargetToServeLocal (which won't match the agent target format)
        !(
          typeof dep === 'object' &&
          dep.projects?.[0] === targetProject.name &&
          dep.target === 'serve'
        ),
    ),
    {
      projects: [targetProject.name],
      target: agentServeLocalTargetName,
    },
    clientGenTarget,
    clientGenWatchTarget,
  ];
  updateProjectConfiguration(tree, sourceProject.name, sourceProject);

  // Add an override to runtime-config for the serve-local target to use the local HTTP url
  const runtimeConfigProvider = joinPathFragments(
    sourceProject.root,
    'src',
    'components',
    'RuntimeConfig',
    'index.tsx',
  );
  if (tree.exists(runtimeConfigProvider)) {
    const localUrl = `http://localhost:${options.port}/`;
    await applyGritQL(
      tree,
      runtimeConfigProvider,
      `\`if ($cond) { $stmts }\` => raw\`if ($cond) {\n    $stmts\n    runtimeConfig.apis.${options.agentNameClassName} = '${localUrl}';\n  }\` where { $cond <: contains \`'serve-local'\`, $stmts <: within \`const applyOverrides = $_\` }`,
    );
  }
};
