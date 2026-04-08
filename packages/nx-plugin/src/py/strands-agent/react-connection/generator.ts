/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format';
import {
  ComponentMetadata,
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { addOpenApiReactClient } from '../../../utils/connection/open-api/react';
import { ResolvedConnectionOptions } from '../../../connection/generator';
import { toClassName, toSnakeCase } from '../../../utils/names';
import { sortObjectKeys } from '../../../utils/object';
import { addPyStrandsAgentTargetToServeLocal } from './serve-local';

export const PY_STRANDS_AGENT_REACT_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const pyStrandsAgentReactConnectionGenerator = async (
  tree: Tree,
  options: ResolvedConnectionOptions,
) => {
  const frontendProjectConfig = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const agentProjectConfig = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  const targetComponent: ComponentMetadata | undefined =
    options.targetComponent;

  // Extract agent metadata from the target component or project metadata
  const metadata = agentProjectConfig.metadata as any;
  const agentName = targetComponent?.name ?? 'agent';
  const agentNameClassName = targetComponent?.rc ?? toClassName(agentName);
  const agentPort = targetComponent?.port ?? metadata?.ports?.[0] ?? 8081;
  const auth = targetComponent?.auth ?? metadata?.auth ?? 'IAM';

  // Determine the module name from the project source root
  const moduleName = getModuleName(agentProjectConfig);
  const agentNameSnakeCase = toSnakeCase(agentName);
  const agentTargetPrefix = targetComponent?.name ? agentName : 'agent';

  // Add OpenAPI spec generation script scoped to this agent
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files/agent'),
    agentProjectConfig.root,
    {
      moduleName,
      agentNameSnakeCase,
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  // Instrument the OpenAPI spec generation as a target on the agent project
  const openApiTargetName = `${agentTargetPrefix}-openapi`;
  const openApiDist = joinPathFragments(
    'dist',
    agentProjectConfig.root,
    'openapi',
    agentNameSnakeCase,
  );
  const specPath = joinPathFragments(openApiDist, 'openapi.json');

  updateProjectConfiguration(tree, agentProjectConfig.name, {
    ...agentProjectConfig,
    targets: sortObjectKeys({
      ...agentProjectConfig.targets,
      [openApiTargetName]: {
        cache: true,
        executor: 'nx:run-commands',
        outputs: [
          `{workspaceRoot}/dist/{projectRoot}/openapi/${agentNameSnakeCase}`,
        ],
        options: {
          commands: [
            `uv run python {projectRoot}/scripts/${agentNameSnakeCase}_openapi.py "dist/{projectRoot}/openapi/${agentNameSnakeCase}/openapi.json"`,
          ],
        },
      },
    }),
  });

  // Use the shared OpenAPI react client utility for hooks, providers, and build targets.
  // Serve-local is handled separately below using the agent-specific serve-local target.
  const apiName = agentNameClassName;
  await addOpenApiReactClient(tree, {
    apiName,
    frontendProjectConfig,
    backendProjectConfig: agentProjectConfig,
    specBuildProject: agentProjectConfig,
    specPath,
    specBuildTargetName: `${agentProjectConfig.name}:${openApiTargetName}`,
    auth,
    port: agentPort,
    isAgentRuntime: true,
    skipServeLocal: true,
  });

  // Add serve-local integration using the agent's serve-local target
  await addPyStrandsAgentTargetToServeLocal(
    tree,
    frontendProjectConfig.name,
    agentProjectConfig.name,
    {
      agentName,
      agentNameClassName,
      port: agentPort,
      targetComponent,
    },
  );

  await addGeneratorMetricsIfApplicable(tree, [
    PY_STRANDS_AGENT_REACT_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

/**
 * Determine the Python module name from the project configuration
 */
const getModuleName = (
  projectConfig: ReturnType<typeof readProjectConfigurationUnqualified>,
): string => {
  if (projectConfig.sourceRoot) {
    const sourceRootParts = projectConfig.sourceRoot.split('/');
    return sourceRootParts[sourceRootParts.length - 1];
  }
  throw new Error(
    `Could not determine sourceRoot for project ${projectConfig.name}`,
  );
};

export default pyStrandsAgentReactConnectionGenerator;
