/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { addAgentTargetToLocalDev } from '../../../connection/agent-local-dev';
import { kebabCase } from '../../../utils/names';
import type { ComponentMetadata } from '../../../utils/nx';

export interface PyAgentLocalDevOptions {
  agentName: string;
  agentNameClassName: string;
  port: number;
  targetComponent?: ComponentMetadata;
  additionalDependencyTargets?: string[];
}

/**
 * Adds the given py strands agent target project to the source project's dev target.
 * Updates the runtime config provider (if it exists) to point to the local HTTP URL.
 */
export const addPyAgentTargetToLocalDev = async (
  tree: Tree,
  sourceProjectName: string,
  targetProjectName: string,
  options: PyAgentLocalDevOptions,
) => {
  // AG-UI clients POST to the runtime config URL directly, so it must point at
  // the agent's `/invocations` endpoint. HTTP agents go through the generated
  // OpenAPI client, which appends the `/invocations` operation path itself, so
  // its base URL must omit it (otherwise the request hits `/invocations/invocations`).
  const protocol = (options.targetComponent?.protocol ?? 'http').toLowerCase();
  const localUrl =
    protocol === 'ag-ui'
      ? `http://localhost:${options.port}/invocations`
      : `http://localhost:${options.port}`;

  await addAgentTargetToLocalDev(tree, sourceProjectName, targetProjectName, {
    agentNameClassName: options.agentNameClassName,
    port: options.port,
    targetComponent: options.targetComponent,
    runtimeConfigNamespace: 'agentRuntimes',
    localUrl,
    additionalDependencyTargets: options.additionalDependencyTargets,
  });
};

/**
 * Build the OpenAPI client generation target names for an HTTP agent so
 * that local API changes regenerate the client.
 */
export const openApiClientLocalDevDeps = (
  agentNameClassName: string,
): string[] => {
  const clientGenTarget = `generate:${kebabCase(agentNameClassName)}-client`;
  return [clientGenTarget, `watch-${clientGenTarget}`];
};
