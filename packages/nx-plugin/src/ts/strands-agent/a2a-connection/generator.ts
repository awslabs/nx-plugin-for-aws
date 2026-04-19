/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  GeneratorCallback,
  OverwriteStrategy,
  Tree,
  addDependenciesToPackageJson,
  generateFiles,
  installPackagesTask,
  joinPathFragments,
  updateProjectConfiguration,
} from '@nx/devkit';
import { TsStrandsAgentA2aConnectionGeneratorSchema } from './schema';
import {
  NxGeneratorInfo,
  getGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics';
import { formatFilesInSubtree } from '../../../utils/format';
import { kebabCase } from '../../../utils/names';
import { withVersions } from '../../../utils/versions';
import { getNpmScope } from '../../../utils/npm-scope';
import {
  addDestructuredImport,
  addStarExport,
  applyGritQL,
} from '../../../utils/ast';
import {
  ensureTypeScriptAgentConnectionProject,
  addTypeScriptCoreClient,
  AGENT_CONNECTION_PROJECT_DIR,
} from '../../../utils/agent-connection/agent-connection';

export const TS_STRANDS_AGENT_A2A_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsStrandsAgentA2aConnectionGenerator = async (
  tree: Tree,
  options: TsStrandsAgentA2aConnectionGeneratorSchema,
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
  const targetAgentComponent = options.targetComponent;

  if (!agentComponent || !targetAgentComponent) {
    throw new Error(
      'Both sourceComponent and targetComponent must be provided for ts#strands-agent -> a2a connections',
    );
  }

  if (targetAgentComponent.protocol !== 'A2A') {
    throw new Error(
      `Target agent '${targetAgentComponent.name}' uses the ${targetAgentComponent.protocol ?? 'HTTP'} protocol — only A2A agents can be connected as tools.`,
    );
  }

  if (targetAgentComponent.auth && targetAgentComponent.auth !== 'IAM') {
    throw new Error(
      `A2A agent connection currently only supports IAM authentication, but '${targetAgentComponent.name}' uses '${targetAgentComponent.auth}' authentication.`,
    );
  }

  const targetAgentComponentName = targetAgentComponent.name ?? 'agent';
  const targetAgentClassName = targetAgentComponent.rc as string;
  const targetAgentKebabCase = kebabCase(targetAgentClassName);
  const targetAgentPort = targetAgentComponent.port ?? 9000;

  const npmScope = getNpmScope(tree);

  // 1. Ensure the shared agent-connection project exists + has the A2A core client
  await ensureTypeScriptAgentConnectionProject(tree);
  addTypeScriptCoreClient(tree, 'a2a');

  // 2. Generate the per-connection <Name>Client into app/
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'agent-connection', 'app'),
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'app'),
    {
      targetAgentKebabCase,
      targetAgentClassName,
      targetAgentPort,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Add re-export to index.ts
  await addStarExport(
    tree,
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'index.ts'),
    `./app/${targetAgentKebabCase}-client.js`,
  );

  // 3. AST transform agent.ts to add the remote A2A agent as a tool
  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    agentComponent.path ?? 'src',
  );
  const agentFilePath = joinPathFragments(agentSourceDir, 'agent.ts');

  if (tree.exists(agentFilePath)) {
    const clientClassName = `${targetAgentClassName}Client`;
    const clientVarName =
      targetAgentClassName.charAt(0).toLowerCase() +
      targetAgentClassName.slice(1);
    const toolName = `ask${targetAgentClassName}`;
    const toolVarName = `${clientVarName}Tool`;

    // Ensure tool + z imports are available
    await addDestructuredImport(
      tree,
      agentFilePath,
      ['tool'],
      '@strands-agents/sdk',
    );
    await addDestructuredImport(tree, agentFilePath, ['z'], 'zod');
    await addDestructuredImport(
      tree,
      agentFilePath,
      [clientClassName],
      `:${npmScope}/agent-connection`,
    );

    // Build the tool creation + Agent wiring. We wrap the getAgent body so
    // the client can be created per-invocation (passing through sessionId).
    const toolCreationBlock = `const ${clientVarName} = await ${clientClassName}.create(sessionId);
  const ${toolVarName} = tool({
    name: '${toolName}',
    description: 'Delegate a question to the remote ${targetAgentClassName} A2A agent and return its reply.',
    inputSchema: z.object({ prompt: z.string() }),
    callback: async ({ prompt }) => (await ${clientVarName}.invoke(prompt)).toString(),
  });`;

    // Transform the arrow function that contains `new Agent`:
    // - Expression body: wrap in block with tool creation and return
    // - Block body: prepend tool creation statement
    await applyGritQL(
      tree,
      agentFilePath,
      `or { \`async ($p) => new Agent($args)\` => raw\`async ($p) => {
  ${toolCreationBlock}
  return new Agent($args);
}\` where { $program <: not contains \`${clientClassName}.create\` }, \`async ($p) => { $body }\` => raw\`async ($p) => {
  ${toolCreationBlock}
  $body
}\` where { $body <: contains \`new Agent($_)\`, $program <: not contains \`${clientClassName}.create\` } }`,
    );

    // Append the tool to the tools array (after existing items)
    await applyGritQL(
      tree,
      agentFilePath,
      `\`tools: [$items]\` => \`tools: [$items, ${toolVarName}]\` where { $items <: within \`new Agent($_)\`, $items <: not contains \`${toolVarName}\` }`,
    );
  }

  // 4. Set up serve-local target — depend on the target agent's serve-local
  //    so running the host's serve-local also spins up the remote A2A agent.
  const agentName = agentComponent.name ?? 'agent';
  const serveLocalTargetName = `${agentName}-serve-local`;
  const targetServeLocalTargetName = `${targetAgentComponentName}-serve-local`;

  if (sourceProject.targets?.[serveLocalTargetName]) {
    const target = sourceProject.targets[serveLocalTargetName];
    target.dependsOn = [
      ...(target.dependsOn ?? []),
      {
        projects: [targetProject.name],
        target: targetServeLocalTargetName,
      },
    ];
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  // 5. Add dependencies
  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@a2a-js/sdk',
      '@strands-agents/sdk',
      '@aws-lambda-powertools/parameters',
      '@aws-sdk/client-appconfigdata',
      'aws4fetch',
      '@aws-sdk/credential-providers',
      'zod',
    ]),
    {},
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_STRANDS_AGENT_A2A_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsStrandsAgentA2aConnectionGenerator;
