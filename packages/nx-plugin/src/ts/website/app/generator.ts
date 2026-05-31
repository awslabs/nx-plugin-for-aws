/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { GeneratorCallback, Tree } from '@nx/devkit';
import { TsWebsiteGeneratorSchema } from './schema';
import { tsReactWebsiteGenerator } from '../../react-website/app/generator';
import { getGeneratorInfo, NxGeneratorInfo } from '../../../utils/nx';

export const TS_WEBSITE_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsWebsiteGenerator = async (
  tree: Tree,
  schema: TsWebsiteGeneratorSchema,
): Promise<GeneratorCallback> => {
  const { framework: _framework, ...rest } = schema;
  return tsReactWebsiteGenerator(tree, rest);
};

export default tsWebsiteGenerator;
