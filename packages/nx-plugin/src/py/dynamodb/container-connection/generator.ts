/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { getGeneratorInfo, type NxGeneratorInfo } from '../../../utils/nx.js';
import type { PyDynamoDBContainerConnectionGeneratorSchema } from './schema';

export const PY_DYNAMODB_CONTAINER_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Connect a py#container service to a py#dynamodb project.
 *
 * Contract stub. Owned by the connections lane.
 */
export const pyDynamoDBContainerConnectionGenerator = async (
  _tree: Tree,
  options: PyDynamoDBContainerConnectionGeneratorSchema,
): Promise<void> => {
  // TODO(connections lane)
  throw new Error(
    `py#dynamodb#container-connection is not implemented yet (${options.sourceProject} -> ${options.targetProject})`,
  );
};

export default pyDynamoDBContainerConnectionGenerator;
