/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { getGeneratorInfo, type NxGeneratorInfo } from '../../../utils/nx.js';
import type { TsDynamoDBContainerConnectionGeneratorSchema } from './schema';

export const TS_DYNAMODB_CONTAINER_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Connect a ts#container service to a ts#dynamodb project.
 *
 * Contract stub. Owned by the connections lane.
 */
export const tsDynamoDBContainerConnectionGenerator = async (
  _tree: Tree,
  options: TsDynamoDBContainerConnectionGeneratorSchema,
): Promise<void> => {
  // TODO(connections lane)
  throw new Error(
    `ts#dynamodb#container-connection is not implemented yet (${options.sourceProject} -> ${options.targetProject})`,
  );
};

export default tsDynamoDBContainerConnectionGenerator;
