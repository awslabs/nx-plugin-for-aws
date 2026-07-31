/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { addTsDependencies } from '../../../utils/add-dependencies';
import {
  AGENT_CONNECTION_DEPENDENCIES,
  AGENT_CONNECTION_PROJECT_DIR,
  addTypeScriptClientToAgent,
  addTypeScriptCoreClient,
  ensureTypeScriptAgentConnectionProject,
} from '../../../utils/agent-connection/agent-connection';
import { addDestructuredImport, addStarExport } from '../../../utils/ast';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../../utils/declared-dependencies';
import { formatFilesInSubtree } from '../../../utils/format';
import { installDependencies } from '../../../utils/install';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { esmVars } from '../../../utils/module-format';
import { kebabCase } from '../../../utils/names';
import { getNpmScope } from '../../../utils/npm-scope';
import {
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { toProjectRelativePath } from '../../../utils/paths';
import type { TsAgentMcpConnectionGeneratorSchema } from './schema';

// The MCP core client + vended client need these whatever the connection's
// options, so no entry is conditional.
export const DEPENDENCIES = declareDependencies()({
  ts: [
    { name: '@modelcontextprotocol/sdk' },
    { name: '@strands-agents/sdk' },
    { name: '@aws-lambda-powertools/parameters' },
    { name: '@aws-sdk/client-appconfigdata' },
    { name: 'aws4fetch' },
    { name: '@aws-sdk/credential-providers' },
    ...ownedElsewhere(AGENT_CONNECTION_DEPENDENCIES),
  ],
});

export const TS_AGENT_MCP_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

export const tsAgentMcpConnectionGenerator = async (
  tree: Tree,
  options: TsAgentMcpConnectionGeneratorSchema,
): Promise<GeneratorCallback> => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  const agentComponent = options.sourceComponent;
  const mcpComponent = options.targetComponent;

  if (!agentComponent || !mcpComponent) {
    throw new Error(
      'Both sourceComponent and targetComponent must be provided for ts#agent -> mcp connections',
    );
  }

  if (mcpComponent.auth && mcpComponent.auth.toLowerCase() !== 'iam') {
    throw new Error(
      `MCP server connection currently only supports IAM authentication, but '${mcpComponent.name}' uses '${mcpComponent.auth}' authentication.`,
    );
  }

  const mcpComponentName = mcpComponent.name ?? 'mcp-server';
  const mcpServerClassName = mcpComponent.rc as string;
  const mcpServerKebabCase = kebabCase(mcpServerClassName);
  const mcpServerPort = mcpComponent.port ?? 8000;

  const npmScope = getNpmScope(tree);

  // 1. Ensure the shared agent-connection project exists + has the MCP core client
  await ensureTypeScriptAgentConnectionProject(tree, DEPENDENCIES);
  await addTypeScriptCoreClient(tree, 'mcp', DEPENDENCIES);

  // 2. Generate the per-connection <Name>Client into app/
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'agent-connection', 'app'),
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'app'),
    {
      mcpServerKebabCase,
      mcpServerClassName,
      mcpServerPort,
      ...esmVars(tree),
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Add re-export to index.ts
  await addStarExport(
    tree,
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'index.ts'),
    `./app/${mcpServerKebabCase}-client-strands.js`,
  );

  // 3. AST transform agent.ts to add MCP tools
  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    agentComponent.path ?? 'src',
  );
  const agentFilePath = joinPathFragments(agentSourceDir, 'agent.ts');

  if (tree.exists(agentFilePath)) {
    const clientClassName = `${mcpServerClassName}ClientStrands`;
    const clientVarName =
      mcpServerClassName.charAt(0).toLowerCase() + mcpServerClassName.slice(1);

    // Add import for the client
    await addDestructuredImport(
      tree,
      agentFilePath,
      [clientClassName],
      `@${npmScope}/agent-connection`,
    );

    await addTypeScriptClientToAgent(
      tree,
      agentFilePath,
      clientClassName,
      clientVarName,
    );
  }

  // 4. Set up dev target
  const agentName = agentComponent.name ?? 'agent';
  const devTargetName = `${agentName}-dev`;
  const mcpDevTargetName = `${mcpComponentName}-dev`;

  if (sourceProject.targets?.[devTargetName]) {
    addDependencyToTargetIfNotPresent(sourceProject, devTargetName, {
      projects: [targetProject.name],
      target: mcpDevTargetName,
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  // 5. Add dependencies required by the MCP core client + vended client
  addTsDependencies(tree, DEPENDENCIES, { projectRoot: sourceProject.root });

  // Recorded so the version sync knows this connection's dependencies are ours.
  addComponentGeneratorMetadata(
    tree,
    sourceProject.name,
    TS_AGENT_MCP_CONNECTION_GENERATOR_INFO,
    toProjectRelativePath(sourceProject, agentFilePath),
    mcpServerClassName,
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_AGENT_MCP_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default tsAgentMcpConnectionGenerator;
