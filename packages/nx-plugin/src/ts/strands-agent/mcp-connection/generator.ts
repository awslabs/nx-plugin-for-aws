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
import ts, {
  factory,
  ArrayLiteralExpression,
  ArrowFunction,
  Expression,
} from 'typescript';

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
  const templateDir =
    mcpAuth === 'Cognito'
      ? joinPathFragments(
          __dirname,
          'files',
          'agent-connection-cognito',
          'app',
        )
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
      mcpServerClassName.charAt(0).toLowerCase() +
      mcpServerClassName.slice(1);

    // Add import for the client
    addDestructuredImport(
      tree,
      agentFilePath,
      [clientClassName],
      `:${npmScope}/agent-connection`,
    );

    // Create: const <clientVarName> = await <ClientClassName>.create(ctx);
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
                [factory.createIdentifier('ctx')],
              ),
            ),
          ),
        ],
        2, // const
      ),
    );

    // Transform the arrow function that contains `new Agent` to have a block body
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
                factory.createReturnStatement(arrow.body as Expression),
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
        if (arr.getText().includes(clientVarName)) return node;

        return factory.updateArrayLiteralExpression(arr, [
          factory.createIdentifier(clientVarName),
          ...arr.elements,
        ]);
      },
    );
  }

  // 5. Ensure the agent's tRPC context includes workloadAccessToken
  //    (for projects generated before the base template included it)
  ensureWorkloadAccessTokenContext(tree, agentSourceDir);

  // 6. If Cognito auth, generate infrastructure constructs
  if (mcpAuth === 'Cognito') {
    generateCognitoInfraConstructs(tree, mcpServerClassName);
  }

  // 7. Set up serve-local target
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

  // 8. Add dependencies based on auth type
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
      withVersions([
        ...commonDeps,
        'aws4fetch',
        '@aws-sdk/credential-providers',
      ]),
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

/**
 * Ensure the agent's tRPC context includes workloadAccessToken.
 * Handles both new-style (ctx: Context) and old-style (sessionId: string) agents.
 */
function ensureWorkloadAccessTokenContext(
  tree: Tree,
  agentSourceDir: string,
): void {
  const initPath = joinPathFragments(agentSourceDir, 'init.ts');
  const indexPath = joinPathFragments(agentSourceDir, 'index.ts');
  const routerPath = joinPathFragments(agentSourceDir, 'router.ts');
  const agentPath = joinPathFragments(agentSourceDir, 'agent.ts');

  // Add workloadAccessToken to Context interface
  if (tree.exists(initPath)) {
    const content = tree.read(initPath, 'utf-8')!;
    if (!content.includes('workloadAccessToken')) {
      tree.write(
        initPath,
        content.replace(
          'sessionId: string;',
          'sessionId: string;\n  workloadAccessToken?: string;',
        ),
      );
    }
  }

  // Extract workloadaccesstoken header in createContext
  if (tree.exists(indexPath)) {
    const content = tree.read(indexPath, 'utf-8')!;
    if (!content.includes('workloadaccesstoken')) {
      tree.write(
        indexPath,
        content.replace(
          /return \{\s*\n\s*sessionId:/,
          `const workloadAccessToken = ('req' in opts\n      ? opts.req.headers['workloadaccesstoken']\n      : undefined) as string | undefined;\n    return {\n      workloadAccessToken,\n      sessionId:`,
        ),
      );
    }
  }

  // Update router.ts: getAgent(opts.ctx.sessionId) -> getAgent(opts.ctx)
  if (tree.exists(routerPath)) {
    const content = tree.read(routerPath, 'utf-8')!;
    if (content.includes('getAgent(opts.ctx.sessionId)')) {
      tree.write(
        routerPath,
        content.replace('getAgent(opts.ctx.sessionId)', 'getAgent(opts.ctx)'),
      );
    }
  }

  // Update agent.ts: getAgent(sessionId: string) -> getAgent(ctx: Context)
  if (tree.exists(agentPath)) {
    const content = tree.read(agentPath, 'utf-8')!;
    if (
      content.includes('sessionId: string') &&
      !content.includes('ctx: Context')
    ) {
      let updated = content.replace(
        /getAgent\s*=\s*async\s*\(\s*sessionId:\s*string\s*\)/,
        'getAgent = async (ctx: Context)',
      );
      // Replace sessionId references with ctx.sessionId
      updated = updated.replace(
        /console\.log\(`Creating agent for session \$\{sessionId\}`\)/,
        'console.log(`Creating agent for session ${ctx.sessionId}`)',
      );
      // Add Context import if not present
      if (!updated.includes("from './init.js'")) {
        updated = `import type { Context } from './init.js';\n${updated}`;
      }
      tree.write(agentPath, updated);
    }
  }
}

/**
 * Generate CDK constructs for Cognito M2M auth infrastructure.
 *
 * Creates shared constructs (UserIdentity, AgentCoreM2MIdentity) if they don't exist,
 * and per-server constructs (McpServerM2MClient) for each MCP server.
 *
 * Per AWS best practices, each MCP server gets its own resource server and M2M client
 * for least-privilege scope isolation:
 * https://docs.aws.amazon.com/cognito/latest/developerguide/scope-based-multi-tenancy.html
 */
function generateCognitoInfraConstructs(
  tree: Tree,
  mcpServerClassName: string,
): void {
  const constructsCorePath = 'packages/common/constructs/src/core';
  const constructsCoreIndexPath = joinPathFragments(
    constructsCorePath,
    'index.ts',
  );

  // Generate shared constructs (UserIdentity, McpServerM2MClient, AgentCoreM2MIdentity) if not present
  const userIdentityPath = joinPathFragments(
    constructsCorePath,
    'user-identity.ts',
  );
  if (!tree.exists(userIdentityPath)) {
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'constructs', 'core'),
      constructsCorePath,
      { mcpServerClassName },
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );

    // Add re-exports for all Cognito constructs
    if (tree.exists(constructsCoreIndexPath)) {
      addStarExport(tree, constructsCoreIndexPath, './user-identity.js');
      addStarExport(
        tree,
        constructsCoreIndexPath,
        './mcp-server-m2m-client.js',
      );
      addStarExport(
        tree,
        constructsCoreIndexPath,
        './agentcore-m2m-identity.js',
      );
    }
  }
}

export default tsStrandsAgentMcpConnectionGenerator;
