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

  await addLocalDevRuntimeConfigOverride(tree, sourceProject, {
    namespace: options.runtimeConfigNamespace,
    key: options.agentNameClassName,
    localUrl: options.localUrl,
  });
};

export interface GatewayLocalDevOptions {
  gatewayClassName: string;
  /** Local port the gateway project's dev target listens on. */
  port: number;
  /**
   * Additional targets to add as dev dependencies.
   */
  additionalDependencyTargets?: string[];
}

/**
 * Adds an AgentCore Gateway project's dev target as a dependency of the
 * source project's dev target (transitively starting the gateway's attached
 * agents), and updates the RuntimeConfig provider to point the gateway's
 * runtime config entry at the local gateway.
 */
export const addGatewayTargetToLocalDev = async (
  tree: Tree,
  sourceProjectName: string,
  gatewayProjectName: string,
  options: GatewayLocalDevOptions,
) => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    sourceProjectName,
  );
  const gatewayProject = readProjectConfigurationUnqualified(
    tree,
    gatewayProjectName,
  );

  // A gateway is its own standalone project, so it exposes plain dev
  if (
    !(
      gatewayProject.targets?.['dev']?.continuous &&
      sourceProject.targets?.['dev']
    )
  ) {
    return;
  }

  addDependencyToTargetIfNotPresent(sourceProject, 'dev', {
    projects: [gatewayProject.name],
    target: 'dev',
  });
  for (const additional of options.additionalDependencyTargets ?? []) {
    addDependencyToTargetIfNotPresent(sourceProject, 'dev', additional);
  }
  updateProjectConfiguration(tree, sourceProject.name, sourceProject);

  await addLocalDevRuntimeConfigOverride(tree, sourceProject, {
    namespace: 'gateways',
    key: options.gatewayClassName,
    localUrl: `http://localhost:${options.port}`,
  });
};

/**
 * Add an override to the source project's RuntimeConfig provider so the dev
 * target uses the local url. Idempotent.
 */
const addLocalDevRuntimeConfigOverride = async (
  tree: Tree,
  sourceProject: { root: string },
  options: { namespace: string; key: string; localUrl: string },
) => {
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
      `\`if ($cond) { $stmts }\` => raw\`if ($cond) {\n    $stmts\n    runtimeConfig.${options.namespace}.${options.key} = '${options.localUrl}';\n  }\` where { $cond <: contains \`'local-dev'\`, $stmts <: within \`const applyOverrides = $_\`, $stmts <: not contains \`runtimeConfig.${options.namespace}.${options.key}\` }`,
    );
  }
};
