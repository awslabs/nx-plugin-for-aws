/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { addAgentTargetToServeLocal } from '../../../connection/agent-serve-local';
import { ComponentMetadata } from '../../../utils/nx';

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
  await addAgentTargetToServeLocal(tree, sourceProjectName, targetProjectName, {
    agentNameClassName: options.agentNameClassName,
    port: options.port,
    targetComponent: options.targetComponent,
    runtimeConfigNamespace: 'agentRuntimes',
    localUrl: `ws://localhost:${options.port}/ws`,
  });
};
