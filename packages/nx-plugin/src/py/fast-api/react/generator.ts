/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { installPackagesTask, Tree } from '@nx/devkit';
import { FastApiReactGeneratorSchema } from './schema';
import { formatFilesInSubtree } from '../../../utils/format';
import {
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { addOpenApiGeneration } from './open-api';
import { addOpenApiReactClient } from '../../../utils/api-connection/open-api/react';

export const FAST_API_REACT_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const fastApiReactGenerator = async (
  tree: Tree,
  options: FastApiReactGeneratorSchema,
) => {
  const frontendProjectConfig = readProjectConfigurationUnqualified(
    tree,
    options.frontendProjectName,
  );
  const fastApiProjectConfig = readProjectConfigurationUnqualified(
    tree,
    options.fastApiProjectName,
  );

  // Add OpenAPI spec generation to the project, run as part of build
  const { specPath } = addOpenApiGeneration(tree, {
    project: fastApiProjectConfig,
  });

  const metadata = fastApiProjectConfig.metadata as any;
  const apiName = metadata?.apiName;
  const auth = metadata?.auth ?? 'IAM';
  const port = metadata?.port ?? metadata?.ports?.[0] ?? 8000;

  await addOpenApiReactClient(tree, {
    apiName,
    frontendProjectConfig,
    backendProjectConfig: fastApiProjectConfig,
    specBuildProject: fastApiProjectConfig,
    specPath,
    specBuildTargetName: `${fastApiProjectConfig.name}:openapi`,
    auth,
    port,
  });

  await addGeneratorMetricsIfApplicable(tree, [FAST_API_REACT_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default fastApiReactGenerator;
