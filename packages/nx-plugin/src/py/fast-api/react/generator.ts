/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, type Tree } from '@nx/devkit';
import {
  addOpenApiReactClient,
  OPEN_API_REACT_DEPENDENCIES,
} from '../../../utils/connection/open-api/react';
import { declareDependencies } from '../../../utils/declared-dependencies';
import { formatFilesInSubtree } from '../../../utils/format';
import { installDependencies } from '../../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { toClassName } from '../../../utils/names';
import {
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { toProjectRelativePath } from '../../../utils/paths';
import { addOpenApiGeneration } from './open-api';
import type { FastApiReactGeneratorSchema } from './schema';

export const DEPENDENCIES = declareDependencies()({
  ts: [...OPEN_API_REACT_DEPENDENCIES],
});

export const FAST_API_REACT_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

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
  const auth = (metadata?.auth ?? 'iam').toLowerCase();
  const port = metadata?.port ?? metadata?.ports?.[0] ?? 8000;

  await addOpenApiReactClient(
    tree,
    {
      apiName,
      frontendProjectConfig,
      backendProjectConfig: fastApiProjectConfig,
      specBuildProject: fastApiProjectConfig,
      specPath,
      specBuildTargetName: `${fastApiProjectConfig.name}:openapi`,
      auth,
      port,
    },
    DEPENDENCIES,
  );

  const apiNameClassName = toClassName(apiName);

  // Recorded so the version sync knows this connection's dependencies are ours.
  addComponentGeneratorMetadata(
    tree,
    frontendProjectConfig.name,
    FAST_API_REACT_GENERATOR_INFO,
    toProjectRelativePath(
      frontendProjectConfig,
      joinPathFragments(
        frontendProjectConfig.sourceRoot,
        'components',
        `${apiNameClassName}Provider`,
      ),
    ),
    apiNameClassName,
  );

  await addGeneratorMetricsIfApplicable(tree, [FAST_API_REACT_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default fastApiReactGenerator;
