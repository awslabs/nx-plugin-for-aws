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
  ensureAgentCoreIdentityModule,
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
  const mcpAuth = (mcpComponent.auth as string) ?? 'IAM';

  const npmScope = getNpmScope(tree);

  // 1. Ensure the shared agent-connection project exists
  await ensureTypeScriptAgentConnectionProject(tree);

  // 2. If Cognito auth, ensure the AgentCore Identity core module exists
  if (mcpAuth === 'Cognito') {
    ensureAgentCoreIdentityModule(tree);
  }

  // 3. Generate the per-connection <Name>Client into app/
  //    Use the Cognito template if auth is Cognito, otherwise use the IAM template
  const templateDir =
    mcpAuth === 'Cognito'
      ? joinPathFragments(__dirname, 'files', 'agent-connection-cognito', 'app')
      : joinPathFragments(__dirname, 'files', 'agent-connection', 'app');

  generateFiles(
    tree,
    templateDir,
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'app'),
    {
      mcpServerKebabCase,
      mcpServerClassName,
      mcpServerPort,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Add re-export to index.ts
  addStarExport(
    tree,
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'index.ts'),
    `./app/${mcpServerKebabCase}-client.js`,
  );

  // 4. AST transform agent.ts to add MCP tools
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
    addDestructuredImport(
      tree,
      agentFilePath,
      [clientClassName],
      `:${npmScope}/agent-connection`,
    );

    // Build the arguments for the create() call
    // IAM: create(sessionId)
    // Cognito: create(sessionId, workloadAccessToken)
    const createArgs: Expression[] = [factory.createIdentifier('sessionId')];
    if (mcpAuth === 'Cognito') {
      createArgs.push(factory.createIdentifier('workloadAccessToken'));
    }

    // Create: const <clientVarName> = await <ClientClassName>.create(...args);
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
                createArgs,
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

  // 5. Thread workload access token through the agent's tRPC context (Cognito auth only)
  if (mcpAuth === 'Cognito') {
    const initPath = joinPathFragments(agentSourceDir, 'init.ts');
    const indexPath = joinPathFragments(agentSourceDir, 'index.ts');
    const routerPath = joinPathFragments(agentSourceDir, 'router.ts');

    // Add workloadAccessToken to Context interface in init.ts
    if (tree.exists(initPath)) {
      const initContent = tree.read(initPath, 'utf-8')!;
      if (!initContent.includes('workloadAccessToken')) {
        tree.write(
          initPath,
          initContent.replace(
            'sessionId: string;',
            'sessionId: string;\n  workloadAccessToken?: string;',
          ),
        );
      }
    }

    // Extract workloadaccesstoken header in index.ts createContext
    if (tree.exists(indexPath)) {
      const indexContent = tree.read(indexPath, 'utf-8')!;
      if (!indexContent.includes('workloadaccesstoken')) {
        tree.write(
          indexPath,
          indexContent
            .replace(
              /return \{\s*\n\s*sessionId:/,
              `const workloadAccessToken = ('req' in opts\n      ? opts.req.headers['workloadaccesstoken']\n      : undefined) as string | undefined;\n    return {\n      workloadAccessToken,\n      sessionId:`,
            ),
        );
      }
    }

    // Pass workloadAccessToken in router.ts getAgent call
    if (tree.exists(routerPath)) {
      const routerContent = tree.read(routerPath, 'utf-8')!;
      if (
        !routerContent.includes('workloadAccessToken') &&
        routerContent.includes('getAgent(opts.ctx.sessionId)')
      ) {
        tree.write(
          routerPath,
          routerContent.replace(
            'getAgent(opts.ctx.sessionId)',
            'getAgent(\n        opts.ctx.sessionId,\n        opts.ctx.workloadAccessToken,\n      )',
          ),
        );
      }
    }

    // Add workloadAccessToken parameter to getAgent in agent.ts
    if (tree.exists(agentFilePath)) {
      const agentContent = tree.read(agentFilePath, 'utf-8')!;
      if (
        !agentContent.includes('workloadAccessToken') ||
        !agentContent.includes('workloadAccessToken?')
      ) {
        // Add parameter to getAgent function signature
        tree.write(
          agentFilePath,
          agentContent.replace(
            /getAgent\s*=\s*async\s*\(\s*sessionId:\s*string\s*\)/,
            'getAgent = async (\n  sessionId: string,\n  workloadAccessToken?: string,\n)',
          ),
        );
      }
    }
  }

  // 6. Set up serve-local target
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

  // 7. Add dependencies based on auth type
  const commonDeps = [
    '@modelcontextprotocol/sdk',
    '@aws-lambda-powertools/parameters',
    '@aws-sdk/client-appconfigdata',
  ] as const;

  if (mcpAuth === 'Cognito') {
    addDependenciesToPackageJson(
      tree,
      withVersions([...commonDeps, '@aws-sdk/client-bedrock-agentcore']),
      {},
    );
  } else {
    addDependenciesToPackageJson(
      tree,
      withVersions([...commonDeps, 'aws4fetch', '@aws-sdk/credential-providers']),
      {},
    );
  }

  await addGeneratorMetricsIfApplicable(tree, [
    TS_STRANDS_AGENT_MCP_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () => {
    installPackagesTask(tree);
  };
};

export default tsStrandsAgentMcpConnectionGenerator;
