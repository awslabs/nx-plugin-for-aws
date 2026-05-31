/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { TsWebsiteAuthGeneratorSchema } from './schema';
import { tsReactWebsiteAuthGenerator } from '../../react-website/cognito-auth/generator';
import { getGeneratorInfo, NxGeneratorInfo } from '../../../utils/nx';

export const TS_WEBSITE_AUTH_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export async function tsWebsiteAuthGenerator(
  tree: Tree,
  schema: TsWebsiteAuthGeneratorSchema,
) {
  return tsReactWebsiteAuthGenerator(tree, {
    project: schema.project,
    allowSignup: schema.allowSignup,
    cognitoDomain: schema.cognitoDomain,
    iacProvider: schema.iacProvider,
  });
}

export default tsWebsiteAuthGenerator;
