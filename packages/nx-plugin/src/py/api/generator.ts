/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { getGeneratorInfo, type NxGeneratorInfo } from '../../utils/nx';
import { pyFastApiProjectGenerator } from '../fast-api/generator';
import type { PyApiGeneratorSchema } from './schema';

export const PY_API_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export async function pyApiGenerator(
  tree: Tree,
  options: PyApiGeneratorSchema,
) {
  const framework = options.framework ?? 'fastapi';

  switch (framework) {
    case 'fastapi':
      return pyFastApiProjectGenerator(tree, {
        name: options.name,
        infra: options.infra,
        integrationPattern: options.integrationPattern,
        auth: options.auth,
        directory: options.directory,
        subDirectory: options.subDirectory,
        moduleName: options.moduleName,
        iac: options.iac,
        preferInstallDependencies: options.preferInstallDependencies,
      });
  }
}

export default pyApiGenerator;
