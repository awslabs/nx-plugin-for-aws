/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  type GeneratorCallback,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import {
  AGENT_CONNECTION_PROJECT_DIR,
  addTypeScriptClientToAgent,
  addTypeScriptCoreClient,
  addTypeScriptLangchainClientToAgent,
  ensureTypeScriptAgentConnectionProject,
} from '../../../utils/agent-connection/agent-connection';
import { addDestructuredImport, addStarExport } from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { kebabCase } from '../../../utils/names';
import { getNpmScope } from '../../../utils/npm-scope';
import {
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { withVersions } from '../../../utils/versions';
import type { TsAgentMcpConnectionGeneratorSchema } from './schema';

export const TS_AGENT_MCP_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

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

  // The transform applied to agent.ts depends on the source agent's framework:
  // Strands wraps `new Agent(...)` and spreads an McpClient into its tools;
  // LangChain loads StructuredTools and spreads them into createReactAgent(...).
  const framework =
    agentComponent.framework === 'langchain' ? 'langchain' : 'strands';
  const isLangchain = framework === 'langchain';
  const clientSuffix = isLangchain ? 'LangChain' : 'Strands';
  const clientModuleSuffix = isLangchain ? 'langchain' : 'strands';

  const npmScope = getNpmScope(tree);

  // 1. Ensure the shared agent-connection project exists + has the MCP core
  //    client for the source agent's framework (Layer-2).
  await ensureTypeScriptAgentConnectionProject(tree);
  await addTypeScriptCoreClient(tree, 'mcp', framework);

  // 2. Generate the per-connection <Name>Client into app/
  generateFiles(
    tree,
    isLangchain
      ? joinPathFragments(__dirname, 'files', 'langchain', 'agent-connection', 'app')
      : joinPathFragments(__dirname, 'files', 'agent-connection', 'app'),
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'app'),
    {
      mcpServerKebabCase,
      mcpServerClassName,
      mcpServerPort,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Add re-export to index.ts
  await addStarExport(
    tree,
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'index.ts'),
    `./app/${mcpServerKebabCase}-client-${clientModuleSuffix}.js`,
  );

  // 3. AST transform agent.ts to add MCP tools
  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    agentComponent.path ?? 'src',
  );
  const agentFilePath = joinPathFragments(agentSourceDir, 'agent.ts');

  if (tree.exists(agentFilePath)) {
    const clientClassName = `${mcpServerClassName}Client${clientSuffix}`;
    const clientVarName =
      mcpServerClassName.charAt(0).toLowerCase() + mcpServerClassName.slice(1);

    // Add import for the client
    await addDestructuredImport(
      tree,
      agentFilePath,
      [clientClassName],
      `:${npmScope}/agent-connection`,
    );

    if (isLangchain) {
      await addTypeScriptLangchainClientToAgent(
        tree,
        agentFilePath,
        clientClassName,
        clientVarName,
      );
    } else {
      await addTypeScriptClientToAgent(
        tree,
        agentFilePath,
        clientClassName,
        clientVarName,
      );
    }
  }

  // 4. Set up serve-local target
  const agentName = agentComponent.name ?? 'agent';
  const serveLocalTargetName = `${agentName}-serve-local`;
  const mcpServeLocalTargetName = `${mcpComponentName}-serve-local`;

  if (sourceProject.targets?.[serveLocalTargetName]) {
    addDependencyToTargetIfNotPresent(sourceProject, serveLocalTargetName, {
      projects: [targetProject.name],
      target: mcpServeLocalTargetName,
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  // 5. Add dependencies required by the MCP core client + vended client. The
  //    Strands Layer-2 client pulls @strands-agents/sdk; the LangChain Layer-2
  //    client pulls @langchain/mcp-adapters + @langchain/core (and must not pull
  //    Strands in).
  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@modelcontextprotocol/sdk',
      '@aws-lambda-powertools/parameters',
      '@aws-sdk/client-appconfigdata',
      'aws4fetch',
      '@aws-sdk/credential-providers',
      ...(isLangchain
        ? (['@langchain/mcp-adapters', '@langchain/core'] as const)
        : (['@strands-agents/sdk'] as const)),
    ]),
    {},
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_AGENT_MCP_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsAgentMcpConnectionGenerator;
