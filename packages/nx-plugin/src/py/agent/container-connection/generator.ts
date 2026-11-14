/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { getGeneratorInfo, type NxGeneratorInfo } from '../../../utils/nx.js';
import type { PyAgentContainerConnectionGeneratorSchema } from './schema';

export const PY_AGENT_CONTAINER_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Connect a Python Agent to a ts#container or py#container service.
 *
 * Contract stub. Owned by the connections lane.
 */
export const pyAgentContainerConnectionGenerator = async (
  _tree: Tree,
  options: PyAgentContainerConnectionGeneratorSchema,
): Promise<void> => {
  // TODO(connections lane)
  throw new Error(
    `py#agent#container-connection is not implemented yet (${options.sourceProject} -> ${options.targetProject})`,
  );
};

export default pyAgentContainerConnectionGenerator;
