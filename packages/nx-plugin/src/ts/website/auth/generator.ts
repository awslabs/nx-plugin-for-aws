/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { getGeneratorInfo, type NxGeneratorInfo } from '../../../utils/nx.js';
import { assertSupportedNxVersion } from '../../../utils/nx-version.js';
import { tsReactWebsiteAuthGenerator } from '../../react-website/cognito-auth/generator.js';
import type { TsWebsiteAuthGeneratorSchema } from './schema';

export const TS_WEBSITE_AUTH_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export async function tsWebsiteAuthGenerator(
  tree: Tree,
  schema: TsWebsiteAuthGeneratorSchema,
) {
  assertSupportedNxVersion(tree);
  return tsReactWebsiteAuthGenerator(tree, {
    project: schema.project,
    allowSignup: schema.allowSignup,
    cognitoDomain: schema.cognitoDomain,
    iac: schema.iac,
    preferInstallDependencies: schema.preferInstallDependencies,
  });
}

export default tsWebsiteAuthGenerator;
