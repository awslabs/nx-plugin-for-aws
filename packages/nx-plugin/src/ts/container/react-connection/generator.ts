/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { getGeneratorInfo, type NxGeneratorInfo } from '../../../utils/nx.js';
import type { TsContainerReactConnectionGeneratorSchema } from './schema';

export const TS_CONTAINER_REACT_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Connect a React website to a ts#container or py#container service.
 *
 * Contract stub. Owned by the connections lane.
 */
export const tsContainerReactConnectionGenerator = async (
  _tree: Tree,
  options: TsContainerReactConnectionGeneratorSchema,
): Promise<void> => {
  // TODO(connections lane)
  throw new Error(
    `ts#container#react-connection is not implemented yet (${options.sourceProject} -> ${options.targetProject})`,
  );
};

export default tsContainerReactConnectionGenerator;
