/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { PyApiGeneratorSchema } from './schema';
import { NxGeneratorInfo, getGeneratorInfo } from '../../utils/nx';
import { pyFastApiProjectGenerator } from '../fast-api/generator';

export const PY_API_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function pyApiGenerator(
  tree: Tree,
  options: PyApiGeneratorSchema,
) {
  const framework = options.framework ?? 'fastapi';

  switch (framework) {
    case 'fastapi':
      return pyFastApiProjectGenerator(tree, {
        name: options.name,
        computeType: options.computeType,
        integrationPattern: options.integrationPattern,
        auth: options.auth,
        directory: options.directory,
        subDirectory: options.subDirectory,
        moduleName: options.moduleName,
        iacProvider: options.iacProvider,
      });
  }
}

export default pyApiGenerator;
