/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { getGeneratorInfo, type NxGeneratorInfo } from '../../../utils/nx';
import { tsReactWebsiteAuthGenerator } from '../../react-website/cognito-auth/generator';
import type { TsWebsiteAuthGeneratorSchema } from './schema';

export const TS_WEBSITE_AUTH_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export async function tsWebsiteAuthGenerator(
  tree: Tree,
  schema: TsWebsiteAuthGeneratorSchema,
) {
  return tsReactWebsiteAuthGenerator(tree, {
    project: schema.project,
    allowSignup: schema.allowSignup,
    cognitoDomain: schema.cognitoDomain,
    iac: schema.iac,
  });
}

export default tsWebsiteAuthGenerator;
