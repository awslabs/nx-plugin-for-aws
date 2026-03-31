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
import { TsStrandsAgentMcpConnectionGeneratorSchema } from './schema';
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
  replaceIfExists,
} from '../../../utils/ast';
import {
  ensureTypeScriptAgentConnectionProject,
  AGENT_CONNECTION_PROJECT_DIR,
} from '../../../utils/agent-connection/agent-connection';
import ts, { factory, ArrayLiteralExpression, ArrowFunction, Expression } from 'typescript';

export const TS_STRANDS_AGENT_MCP_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(__filename);

export const tsStrandsAgentMcpConnectionGenerator = async (
  tree: Tree,
  options: TsStrandsAgentMcpConnectionGeneratorSchema,
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
      'Both sourceComponent and targetComponent must be provided for ts#strands-agent -> mcp connections',
    );
  }

  const mcpComponentName = mcpComponent.name ?? 'mcp-server';
  const mcpServerClassName = mcpComponent.rc as string;
  const mcpServerKebabCase = kebabCase(mcpServerClassName);
  const mcpServerPort = mcpComponent.port ?? 8000;

  const npmScope = getNpmScope(tree);

  // 1. Ensure the shared agent-connection project exists
  await ensureTypeScriptAgentConnectionProject(tree);

  // 2. Generate the per-connection <Name>Client into app/
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'agent-connection', 'app'),
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
    `./app/${mcpServerKebabCase}-client.js`,
  );

  // 3. AST transform agent.ts to add MCP tools
  const agentSourceDir = joinPathFragments(
    sourceProject.root,
    agentComponent.path ?? 'src',
  );
  const agentFilePath = joinPathFragments(agentSourceDir, 'agent.ts');

  if (tree.exists(agentFilePath)) {
    const clientClassName = `${mcpServerClassName}Client`;
    const clientVarName =
      mcpServerClassName.charAt(0).toLowerCase() + mcpServerClassName.slice(1);

    // Add import for the client
    await addDestructuredImport(
      tree,
      agentFilePath,
      [clientClassName],
      `:${npmScope}/agent-connection`,
    );

    // Create: const <clientVarName> = await <ClientClassName>.create(sessionId);
    const clientCreationStatement = factory.createVariableStatement(
      undefined,
      factory.createVariableDeclarationList(
        [
          factory.createVariableDeclaration(
            clientVarName,
            undefined,
            undefined,
            factory.createAwaitExpression(
              factory.createCallExpression(
                factory.createPropertyAccessExpression(
                  factory.createIdentifier(clientClassName),
                  'create',
                ),
                undefined,
                [factory.createIdentifier('sessionId')],
              ),
            ),
          ),
        ],
        2, // const
      ),
    );

    // Transform the arrow function that contains `new Agent` to have a block body
    // with the client creation statement before the return
    replaceIfExists(
      tree,
      agentFilePath,
      'ArrowFunction:has(NewExpression[expression.name="Agent"])',
      (node) => {
        const arrow = node as ArrowFunction;

        // Check if already transformed
        if (arrow.getText().includes(clientClassName)) return node;

        // If the body is an expression (not a block), wrap it in a block with return
        if (!ts.isBlock(arrow.body)) {
          return factory.updateArrowFunction(
            arrow,
            arrow.modifiers,
            arrow.typeParameters,
            arrow.parameters,
            arrow.type,
            arrow.equalsGreaterThanToken,
            factory.createBlock(
              [
                clientCreationStatement,
                factory.createReturnStatement(
                  arrow.body as Expression,
                ),
              ],
              true,
            ),
          );
        }

        // Body is already a block — insert before the statement containing `new Agent`
        const b = arrow.body;
        const agentStatementIndex = b.statements.findIndex((s) =>
          s.getText().includes('new Agent('),
        );
        if (agentStatementIndex === -1) return node;

        const newStatements = [...b.statements];
        newStatements.splice(agentStatementIndex, 0, clientCreationStatement);
        return factory.updateArrowFunction(
          arrow,
          arrow.modifiers,
          arrow.typeParameters,
          arrow.parameters,
          arrow.type,
          arrow.equalsGreaterThanToken,
          factory.updateBlock(b, newStatements),
        );
      },
    );

    // Add client to the tools array: tools: [clientVarName, ...existing]
    replaceIfExists(
      tree,
      agentFilePath,
      'NewExpression[expression.name="Agent"] ObjectLiteralExpression PropertyAssignment[name.name="tools"] ArrayLiteralExpression',
      (node) => {
        const arr = node as ArrayLiteralExpression;
        // Check if already added
        if (arr.getText().includes(clientVarName)) return node;

        return factory.updateArrayLiteralExpression(arr, [
          factory.createIdentifier(clientVarName),
          ...arr.elements,
        ]);
      },
    );
  }

  // 4. Set up serve-local target
  const agentName = agentComponent.name ?? 'agent';
  const serveLocalTargetName = `${agentName}-serve-local`;
  const mcpServeLocalTargetName = `${mcpComponentName}-serve-local`;

  if (sourceProject.targets?.[serveLocalTargetName]) {
    const target = sourceProject.targets[serveLocalTargetName];
    target.dependsOn = [
      ...(target.dependsOn ?? []),
      {
        projects: [targetProject.name],
        target: mcpServeLocalTargetName,
      },
    ];
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  // 5. Add dependencies
  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@modelcontextprotocol/sdk',
      '@aws-lambda-powertools/parameters',
      '@aws-sdk/client-appconfigdata',
      'aws4fetch',
      '@aws-sdk/credential-providers',
    ]),
    {},
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_STRANDS_AGENT_MCP_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsStrandsAgentMcpConnectionGenerator;
