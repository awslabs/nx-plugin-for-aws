/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { addAgentTargetToServeLocal } from '../../../connection/agent-serve-local';
import { ComponentMetadata } from '../../../utils/nx';
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
  const clientGenTarget = `generate:${kebabCase(options.agentNameClassName)}-client`;
  const clientGenWatchTarget = `watch-${clientGenTarget}`;

  await addAgentTargetToServeLocal(tree, sourceProjectName, targetProjectName, {
    agentNameClassName: options.agentNameClassName,
    port: options.port,
    targetComponent: options.targetComponent,
    runtimeConfigNamespace: 'agentRuntimes',
    localUrl: `http://localhost:${options.port}/`,
    additionalDependencyTargets: [clientGenTarget, clientGenWatchTarget],
  });
};
