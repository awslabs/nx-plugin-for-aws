/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { TsApiGeneratorSchema } from './schema';
import { NxGeneratorInfo, getGeneratorInfo } from '../../utils/nx';
import { tsTrpcApiGenerator } from '../../trpc/backend/generator';
import { tsSmithyApiGenerator } from '../../smithy/ts/api/generator';

export const TS_API_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function tsApiGenerator(
  tree: Tree,
  options: TsApiGeneratorSchema,
) {
  const framework = options.framework ?? 'trpc';

  switch (framework) {
    case 'trpc':
      return tsTrpcApiGenerator(tree, {
        name: options.name,
        infra: options.infra,
        integrationPattern: options.integrationPattern,
        auth: options.auth,
        directory: options.directory,
        subDirectory: options.subDirectory,
        iacProvider: options.iacProvider,
      });
    case 'smithy':
      return tsSmithyApiGenerator(tree, {
        name: options.name,
        namespace: options.namespace,
        infra: 'rest-lambda',
        integrationPattern: options.integrationPattern,
        auth: options.auth,
        directory: options.directory,
        subDirectory: options.subDirectory,
        iacProvider: options.iacProvider,
      });
  }
}

export default tsApiGenerator;
