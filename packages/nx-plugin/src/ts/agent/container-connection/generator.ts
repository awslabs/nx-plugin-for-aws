/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { getGeneratorInfo, type NxGeneratorInfo } from '../../../utils/nx.js';
import type { TsAgentContainerConnectionGeneratorSchema } from './schema';

export const TS_AGENT_CONTAINER_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Connect a TypeScript Agent to a ts#container or py#container service.
 *
 * Contract stub. Owned by the connections lane.
 */
export const tsAgentContainerConnectionGenerator = async (
  _tree: Tree,
  options: TsAgentContainerConnectionGeneratorSchema,
): Promise<void> => {
  // TODO(connections lane)
  throw new Error(
    `ts#agent#container-connection is not implemented yet (${options.sourceProject} -> ${options.targetProject})`,
  );
};

export default tsAgentContainerConnectionGenerator;
