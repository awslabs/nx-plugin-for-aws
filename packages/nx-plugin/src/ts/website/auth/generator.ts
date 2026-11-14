/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type GeneratorCallback, logger, type Tree } from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { resolveIac } from '../../../utils/iac.js';
import { getGeneratorInfo, type NxGeneratorInfo } from '../../../utils/nx.js';
import { assertSupportedNxVersion } from '../../../utils/nx-version.js';
import { tsReactWebsiteAuthGenerator } from '../../react-website/cognito-auth/generator.js';
import {
  addOidcFederation,
  assertFederationSupported,
  federationNextSteps,
} from './federation.js';
import type { TsWebsiteAuthGeneratorSchema } from './schema';

export const TS_WEBSITE_AUTH_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export async function tsWebsiteAuthGenerator(
  tree: Tree,
  schema: TsWebsiteAuthGeneratorSchema,
): Promise<GeneratorCallback> {
  assertSupportedNxVersion(tree);
  const auth = (): Promise<GeneratorCallback> =>
    tsReactWebsiteAuthGenerator(tree, {
      project: schema.project,
      allowSignup: schema.allowSignup,
      cognitoDomain: schema.cognitoDomain,
      iac: schema.iac,
      preferInstallDependencies: schema.preferInstallDependencies,
    });

  if (schema.federation !== 'oidc') {
    return auth();
  }

  const iac = await resolveIac(tree, schema.iac ?? 'inherit');
  assertFederationSupported(iac);
  const install = await auth();
  await addOidcFederation(tree, iac);
  await formatFilesInSubtree(tree);

  // Printed from the callback so it appears after Nx lists the changed files.
  return async () => {
    await install();
    logger.info(federationNextSteps());
  };
}

export default tsWebsiteAuthGenerator;
