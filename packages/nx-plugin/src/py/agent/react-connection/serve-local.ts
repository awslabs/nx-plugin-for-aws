/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { addAgentTargetToServeLocal } from '../../../connection/agent-serve-local';
import { kebabCase } from '../../../utils/names';
import type { ComponentMetadata } from '../../../utils/nx';

export interface PyAgentServeLocalOptions {
  agentName: string;
  agentNameClassName: string;
  port: number;
  targetComponent?: ComponentMetadata;
  additionalDependencyTargets?: string[];
}

/**
 * Adds the given py strands agent target project to the source project's serve-local target.
 * Updates the runtime config provider (if it exists) to point to the local HTTP URL.
 */
export const addPyAgentTargetToServeLocal = async (
  tree: Tree,
  sourceProjectName: string,
  targetProjectName: string,
  options: PyAgentServeLocalOptions,
) => {
  await addAgentTargetToServeLocal(tree, sourceProjectName, targetProjectName, {
    agentNameClassName: options.agentNameClassName,
    port: options.port,
    targetComponent: options.targetComponent,
    runtimeConfigNamespace: 'agentRuntimes',
    localUrl: `http://localhost:${options.port}/invocations`,
    additionalDependencyTargets: options.additionalDependencyTargets,
  });
};

/**
 * Build the OpenAPI client generation target names for an HTTP agent so
 * that local API changes regenerate the client.
 */
export const openApiClientServeLocalDeps = (
  agentNameClassName: string,
): string[] => {
  const clientGenTarget = `generate:${kebabCase(agentNameClassName)}-client`;
  return [clientGenTarget, `watch-${clientGenTarget}`];
};
