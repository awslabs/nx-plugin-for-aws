/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { GeneratorCallback, Tree } from '@nx/devkit';
import { getGeneratorInfo, type NxGeneratorInfo } from '../../utils/nx';
import { tsAstroDocsGenerator } from '../astro-docs/generator';
import type { TsDocsGeneratorSchema } from './schema';

export const TS_DOCS_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsDocsGenerator = async (
  tree: Tree,
  schema: TsDocsGeneratorSchema,
): Promise<GeneratorCallback> => {
  const { framework: _framework, ...rest } = schema;
  return tsAstroDocsGenerator(tree, rest);
};

export default tsDocsGenerator;
