/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { GeneratorCallback, Tree } from '@nx/devkit';
import { addDcrProxyInfra } from '../../utils/dcr-proxy-constructs/dcr-proxy-constructs';
import { formatFilesInSubtree } from '../../utils/format';
import { resolveIac } from '../../utils/iac';
import { installDependencies } from '../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { kebabCase, toClassName } from '../../utils/names';
import { getGeneratorInfo, type NxGeneratorInfo } from '../../utils/nx';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import type { TsDcrProxyGeneratorSchema } from './schema';

export const TS_DCR_PROXY_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

export const tsDcrProxyGenerator = async (
  tree: Tree,
  options: TsDcrProxyGeneratorSchema,
): Promise<GeneratorCallback> => {
  const name = kebabCase(options.name ? options.name : 'dcr-proxy');
  const nameClassName = toClassName(name);

  // The DCR proxy construct is CDK-only. Its API Gateway + 6 Lambda handlers
  // are not reimplemented for Terraform.
  const iac = await resolveIac(tree, options.iac);
  if (iac !== 'cdk') {
    throw new Error(
      `The ts#dcr-proxy generator only supports the 'cdk' IaC provider, but resolved '${iac}'.`,
    );
  }

  // The DCR proxy only produces a shared CDK construct (+ Lambda handlers); it
  // has no project sources of its own, so it lives entirely in the shared
  // constructs package rather than a standalone Nx project.
  await sharedConstructsGenerator(tree, { iac });

  await addDcrProxyInfra(tree, {
    dcrProxyNameClassName: nameClassName,
    dcrProxyNameKebabCase: name,
  });

  await addGeneratorMetricsIfApplicable(tree, [TS_DCR_PROXY_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default tsDcrProxyGenerator;
