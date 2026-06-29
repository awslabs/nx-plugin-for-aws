/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { addAgentTargetToLocalDev } from '../../../connection/agent-local-dev';
import type { ComponentMetadata } from '../../../utils/nx';

export interface TsAgentLocalDevOptions {
  agentName: string;
  agentNameClassName: string;
  port: number;
  targetComponent?: ComponentMetadata;
}

export const addTsAgentTargetToLocalDev = async (
  tree: Tree,
  sourceProjectName: string,
  targetProjectName: string,
  options: TsAgentLocalDevOptions,
) => {
  const protocol = options.targetComponent?.protocol ?? 'http';
  const localUrl =
    protocol === 'ag-ui'
      ? `http://localhost:${options.port}/invocations`
      : `ws://localhost:${options.port}/ws`;

  await addAgentTargetToLocalDev(tree, sourceProjectName, targetProjectName, {
    agentNameClassName: options.agentNameClassName,
    port: options.port,
    targetComponent: options.targetComponent,
    runtimeConfigNamespace: 'agentRuntimes',
    localUrl,
  });
};
