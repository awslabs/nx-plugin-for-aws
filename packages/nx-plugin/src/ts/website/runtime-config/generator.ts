/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { TsWebsiteRuntimeConfigGeneratorSchema } from './schema';
import { runtimeConfigGenerator } from '../../react-website/runtime-config/generator';
import { getGeneratorInfo, NxGeneratorInfo } from '../../../utils/nx';

export const TS_WEBSITE_RUNTIME_CONFIG_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function tsWebsiteRuntimeConfigGenerator(
  tree: Tree,
  schema: TsWebsiteRuntimeConfigGeneratorSchema,
) {
  return runtimeConfigGenerator(tree, {
    project: schema.project,
  });
}

export default tsWebsiteRuntimeConfigGenerator;
