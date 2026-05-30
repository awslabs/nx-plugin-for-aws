/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { TsWebsiteGeneratorSchema, WebsiteFramework } from './schema';
import { tsReactWebsiteGenerator } from '../../react-website/app/generator';
import { getGeneratorInfo, NxGeneratorInfo } from '../../../utils/nx';

export const SUPPORTED_FRAMEWORKS: WebsiteFramework[] = ['React'];

export const TS_WEBSITE_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function tsWebsiteGenerator(
  tree: Tree,
  schema: TsWebsiteGeneratorSchema,
) {
  const framework = schema.framework ?? 'React';

  switch (framework) {
    case 'React':
      return tsReactWebsiteGenerator(tree, {
        name: schema.name,
        directory: schema.directory,
        subDirectory: schema.subDirectory,
        skipInstall: schema.skipInstall,
        enableTanstackRouter: schema.enableTanstackRouter,
        enableTailwind: schema.enableTailwind,
        uxProvider: schema.uxProvider,
        iacProvider: schema.iacProvider,
      });
    default:
      throw new Error(
        `Unsupported website framework: ${framework}. Supported frameworks: ${SUPPORTED_FRAMEWORKS.join(', ')}`,
      );
  }
}

export default tsWebsiteGenerator;
