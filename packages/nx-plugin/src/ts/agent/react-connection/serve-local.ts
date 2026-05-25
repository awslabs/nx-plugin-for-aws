/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { addAgentTargetToServeLocal } from '../../../connection/agent-serve-local';
import { ComponentMetadata } from '../../../utils/nx';

export interface TsAgentServeLocalOptions {
  agentName: string;
  agentNameClassName: string;
  port: number;
  targetComponent?: ComponentMetadata;
}

export const addTsAgentTargetToServeLocal = async (
  tree: Tree,
  sourceProjectName: string,
  targetProjectName: string,
  options: TsAgentServeLocalOptions,
) => {
  await addAgentTargetToServeLocal(tree, sourceProjectName, targetProjectName, {
    agentNameClassName: options.agentNameClassName,
    port: options.port,
    targetComponent: options.targetComponent,
    runtimeConfigNamespace: 'agentRuntimes',
    localUrl: `ws://localhost:${options.port}/ws`,
  });
};
