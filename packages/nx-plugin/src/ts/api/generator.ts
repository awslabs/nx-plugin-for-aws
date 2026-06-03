/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { tsSmithyApiGenerator } from '../../smithy/ts/api/generator';
import { tsTrpcApiGenerator } from '../../trpc/backend/generator';
import { getGeneratorInfo, type NxGeneratorInfo } from '../../utils/nx';
import type { TsApiGeneratorSchema } from './schema';

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
        iac: options.iac,
      });
    case 'smithy':
      return tsSmithyApiGenerator(tree, {
        name: options.name,
        namespace: options.namespace,
        infra:
          options.infra === 'none'
            ? 'none'
            : ((options.infra ?? 'rest-lambda') as 'rest-lambda'),
        integrationPattern: options.integrationPattern,
        auth: options.auth,
        directory: options.directory,
        subDirectory: options.subDirectory,
        iac: options.iac,
      });
  }
}

export default tsApiGenerator;
