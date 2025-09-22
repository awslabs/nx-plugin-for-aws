/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GeneratorCallback,
  ProjectConfiguration,
  Tree,
  installPackagesTask,
  joinPathFragments,
} from '@nx/devkit';
import { SmithyReactConnectionGeneratorSchema } from './schema';
import {
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics';
import { formatFilesInSubtree } from '../../utils/format';
import { SMITHY_PROJECT_GENERATOR_INFO } from '../project/generator';
import { TS_SMITHY_API_GENERATOR_INFO } from '../ts/api/generator';
import { addOpenApiReactClient } from '../../utils/api-connection/open-api/react';

export const SMITHY_REACT_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const smithyReactConnectionGenerator = async (
  tree: Tree,
  options: SmithyReactConnectionGeneratorSchema,
): Promise<GeneratorCallback> => {
  const frontendProjectConfig = readProjectConfigurationUnqualified(
    tree,
    options.frontendProjectName,
  );
  const targetConfig = readProjectConfigurationUnqualified(
    tree,
    options.smithyModelOrBackendProjectName,
  );

  // Target could either be the model or backend project
  const { modelProjectConfig, backendProjectConfig } = resolveProjectConfig(
    tree,
    targetConfig,
  );

  const backendMetadata = backendProjectConfig.metadata as any;
  const apiName = backendMetadata?.apiName;
  const auth = backendMetadata?.auth ?? 'IAM';
  const port = backendMetadata?.port ?? backendMetadata?.ports?.[0] ?? 3001;

  await addOpenApiReactClient(tree, {
    apiName,
    frontendProjectConfig,
    backendProjectConfig,
    specBuildProject: modelProjectConfig,
    specPath: joinPathFragments(
      'dist',
      modelProjectConfig.root,
      'build',
      'openapi',
      'openapi.json',
    ),
    specBuildTargetName: `${modelProjectConfig.name}:build`,
    auth,
    port,
  });

  await addGeneratorMetricsIfApplicable(tree, [
    SMITHY_REACT_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

const resolveProjectConfig = (
  tree: Tree,
  modelOrBackendConfig: ProjectConfiguration,
) => {
  if (
    ((modelOrBackendConfig.metadata as any) ?? {}).generator ===
    SMITHY_PROJECT_GENERATOR_INFO.id
  ) {
    // It's the model project
    const backendProjectName = ((modelOrBackendConfig.metadata as any) ?? {})
      .backendProject;
    if (!backendProjectName) {
      throw new Error(
        `Could not find associated backend for Smithy model project ${modelOrBackendConfig.name}`,
      );
    }

    return {
      modelProjectConfig: modelOrBackendConfig,
      backendProjectConfig: readProjectConfigurationUnqualified(
        tree,
        backendProjectName,
      ),
    };
  } else if (
    ((modelOrBackendConfig.metadata as any) ?? {}).generator ===
    TS_SMITHY_API_GENERATOR_INFO.id
  ) {
    // It's the backend project
    const modelProjectName = ((modelOrBackendConfig.metadata as any) ?? {})
      .modelProject;
    if (!modelProjectName) {
      throw new Error(
        `Could not find associated model for Smithy backend project ${modelOrBackendConfig.name}`,
      );
    }

    return {
      modelProjectConfig: readProjectConfigurationUnqualified(
        tree,
        ((modelOrBackendConfig.metadata as any) ?? {}).modelProject,
      ),
      backendProjectConfig: modelOrBackendConfig,
    };
  }
  throw new Error(
    `Unsupported api-connection target ${modelOrBackendConfig.name}. Expected a Smithy model or backend project.`,
  );
};

export default smithyReactConnectionGenerator;
