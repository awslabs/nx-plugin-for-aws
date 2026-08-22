/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { GeneratorCallback, Tree } from '@nx/devkit';
import { agentcoreGatewayGenerator } from '../../sdk/agentcore-gateway';
import { agentcoreHarnessGenerator } from '../../sdk/agentcore-harness';
import {
  type ConnectionGeneratorSchema,
  connectionGenerator,
} from '../../sdk/connection';
import { licenseGenerator } from '../../sdk/license';
import {
  type PyAgentGeneratorSchema,
  type PyApiGeneratorSchema,
  type PyRdbGeneratorSchema,
  pyAgentGenerator,
  pyApiGenerator,
  pyDynamoDBGenerator,
  pyLambdaFunctionGenerator,
  pyMcpServerGenerator,
  pyProjectGenerator,
  pyRdbGenerator,
} from '../../sdk/py';
import { terraformProjectGenerator } from '../../sdk/terraform';
import {
  type TsAgentGeneratorSchema,
  type TsApiGeneratorSchema,
  type TsNxMigrationGeneratorSchema,
  type TsRdbGeneratorSchema,
  tsAgentGenerator,
  tsApiGenerator,
  tsAstroDocsGenerator,
  tsDcrProxyGenerator,
  tsDynamoDBGenerator,
  tsInfraGenerator,
  tsLambdaFunctionGenerator,
  tsMcpServerGenerator,
  tsNxGeneratorGenerator,
  tsNxMigrationGenerator,
  tsNxPluginGenerator,
  tsProjectGenerator,
  tsRdbGenerator,
  tsWebsiteAuthGenerator,
  tsWebsiteGenerator,
} from '../../sdk/ts';
import { installDependencies } from '../../utils/install';
import { toSnakeCase } from '../../utils/names';
import { getNpmScope, getNpmScopePrefix } from '../../utils/npm-scope';
import type { InternalTestMatrixGeneratorSchema } from './schema';

/**
 * Scaffolds every generator, component and connection permutation the e2e tests
 * cover, by composing the generators in-process on a single tree.
 *
 * This ships with the plugin so each released version carries the matrix of the
 * generators *it* had. A test upgrading an old workspace scaffolds with the
 * released version's own matrix and never has to reason about which generators
 * existed when — driving the CLI from the test repo instead would couple the
 * test to a generator list that only describes today's plugin.
 *
 * Hidden and undocumented: it exists for the e2e suite, not for users.
 *
 * Options are typed against each generator's schema, so adding a required option
 * or changing an enum breaks the build here rather than silently reducing
 * coverage.
 *
 * Projects are generated with `preferInstallDependencies: false` by default and
 * the returned callback installs once. Nothing composed here reads the project
 * graph (only `ts#sync` does, which is not part of the matrix), so no
 * intermediate install is needed.
 */
export const internalTestMatrixGenerator = async (
  tree: Tree,
  options: InternalTestMatrixGeneratorSchema = {},
): Promise<GeneratorCallback> => {
  const preferInstallDependencies = options.preferInstallDependencies ?? false;
  const defaults = { preferInstallDependencies };
  const projectDefaults = { ...defaults, directory: 'packages' };
  // Fully-qualified project names, which differ per language: TypeScript
  // projects are scope-prefixed, Python ones are dotted snake_case. Derived from
  // the workspace rather than hardcoded, so the matrix works in any workspace.
  const ts = (name: string) => `${getNpmScopePrefix(tree)}${name}`;
  const py = (name: string) =>
    `${toSnakeCase(getNpmScope(tree))}.${toSnakeCase(name)}`;

  // The infrastructure project every other generator deploys into. Which
  // generator owns it depends on the workspace's IaC provider, so the caller
  // asks for the one matching the workspace it created.
  if (options.infra === 'terraform') {
    await terraformProjectGenerator(tree, {
      name: 'infra',
      type: 'application',
      ...projectDefaults,
    });
  } else {
    await tsInfraGenerator(tree, { name: 'infra', ...projectDefaults });
    // A second CDK app with stage config, which only ts#infra offers.
    await tsInfraGenerator(tree, {
      name: 'infra-with-stages',
      stageConfig: true,
      ...projectDefaults,
    });
  }

  // Websites (with and without TanStack Router), a docs site, and auth on each.
  await tsWebsiteGenerator(tree, {
    name: 'website',
    iac: 'inherit',
    ...projectDefaults,
  });
  await tsWebsiteGenerator(tree, {
    name: 'website-no-router',
    tanstackRouter: false,
    iac: 'inherit',
    ...projectDefaults,
  });
  await tsAstroDocsGenerator(tree, { name: 'docs-site', ...defaults });
  await tsWebsiteAuthGenerator(tree, {
    project: ts('website'),
    cognitoDomain: 'test',
    allowSignup: true,
    iac: 'inherit',
    ...defaults,
  });
  await tsWebsiteAuthGenerator(tree, {
    project: ts('website-no-router'),
    cognitoDomain: 'test-no-router',
    allowSignup: true,
    iac: 'inherit',
    ...defaults,
  });

  // tRPC APIs — REST + HTTP, with Cognito and custom auth.
  const tsApis: TsApiGeneratorSchema[] = [
    { name: 'my-api', infra: 'rest-lambda', auth: 'iam', iac: 'inherit' },
    { name: 'my-api-http', infra: 'http-lambda', auth: 'iam', iac: 'inherit' },
    {
      name: 'my-api-cognito',
      infra: 'rest-lambda',
      auth: 'cognito',
      iac: 'inherit',
    },
    {
      name: 'my-api-custom',
      infra: 'rest-lambda',
      auth: 'custom',
      iac: 'inherit',
    },
    {
      name: 'my-api-custom-http',
      infra: 'http-lambda',
      auth: 'custom',
      iac: 'inherit',
    },
    {
      name: 'my-smithy-api',
      framework: 'smithy',
      infra: 'rest-lambda',
      auth: 'iam',
      iac: 'inherit',
    },
  ];
  for (const api of tsApis) {
    await tsApiGenerator(tree, { ...api, ...projectDefaults });
  }

  // Python FastAPI — REST + HTTP, with Cognito and custom auth.
  const pyApis: PyApiGeneratorSchema[] = [
    { name: 'py-api', infra: 'rest-lambda', auth: 'iam', iac: 'inherit' },
    { name: 'py-api-http', infra: 'http-lambda', auth: 'iam', iac: 'inherit' },
    {
      name: 'py-api-custom',
      infra: 'rest-lambda',
      auth: 'custom',
      iac: 'inherit',
    },
    {
      name: 'py-api-custom-http',
      infra: 'http-lambda',
      auth: 'custom',
      iac: 'inherit',
    },
  ];
  for (const api of pyApis) {
    await pyApiGenerator(tree, { ...api, ...projectDefaults });
  }

  // Library projects hosting the components below, each with a lambda function.
  await pyProjectGenerator(tree, {
    name: 'py-project',
    type: 'application',
    ...projectDefaults,
  });
  await tsProjectGenerator(tree, { name: 'ts-project', ...projectDefaults });
  await pyLambdaFunctionGenerator(tree, {
    project: py('py-project'),
    name: 'my-function',
    event: 'Any',
    iac: 'inherit',
    ...defaults,
  });
  await tsLambdaFunctionGenerator(tree, {
    project: 'ts-project',
    name: 'my-function',
    event: 'Any',
    iac: 'inherit',
    ...defaults,
  });

  // MCP servers — uninfra'd and hosted on AgentCore.
  await pyMcpServerGenerator(tree, {
    project: 'py_project',
    name: 'my-mcp-server',
    infra: 'agentcore',
    iac: 'inherit',
    ...defaults,
  });
  await tsMcpServerGenerator(tree, {
    project: 'ts-project',
    name: 'my-mcp-server',
    infra: 'none',
    iac: 'inherit',
    ...defaults,
  });
  await tsMcpServerGenerator(tree, {
    project: 'ts-project',
    name: 'hosted-mcp-server',
    infra: 'agentcore',
    iac: 'inherit',
    ...defaults,
  });

  // OAuth DCR proxy for Cognito-authenticated MCP servers.
  await tsDcrProxyGenerator(tree, {
    name: 'my-dcr-proxy',
    iac: 'inherit',
    ...projectDefaults,
  });

  // TypeScript agents across every protocol and auth permutation. The unnamed
  // one takes the generator's default name, which the connections below use.
  const tsAgents: TsAgentGeneratorSchema[] = [
    {
      project: 'ts-project',
      name: 'my-ts-agent',
      infra: 'none',
      iac: 'inherit',
    },
    { project: 'ts-project', infra: 'agentcore', iac: 'inherit' },
    {
      project: 'ts-project',
      name: 'my-ts-a2a-agent',
      protocol: 'a2a',
      infra: 'agentcore',
      iac: 'inherit',
    },
    {
      project: 'ts-project',
      name: 'my-ts-a2a-agent-cognito',
      protocol: 'a2a',
      auth: 'cognito',
      infra: 'agentcore',
      iac: 'inherit',
    },
    {
      project: 'ts-project',
      name: 'my-ts-agui-agent',
      protocol: 'ag-ui',
      infra: 'agentcore',
      iac: 'inherit',
    },
  ];
  for (const agent of tsAgents) {
    await tsAgentGenerator(tree, { ...agent, ...defaults });
  }

  // Python agents: Strands across every protocol, plus LangChain in its own
  // project — langchain's dependency closure would push the zip-bundled Lambda
  // in py-project past its unzipped size limit.
  const pyAgents: PyAgentGeneratorSchema[] = [
    {
      project: 'py_project',
      name: 'my-agent',
      infra: 'agentcore',
      iac: 'inherit',
    },
    {
      project: 'py_project',
      name: 'my-py-a2a-agent',
      protocol: 'a2a',
      infra: 'agentcore',
      iac: 'inherit',
    },
    {
      project: 'py_project',
      name: 'my-py-a2a-agent-cognito',
      protocol: 'a2a',
      auth: 'cognito',
      infra: 'agentcore',
      iac: 'inherit',
    },
    {
      project: 'py_project',
      name: 'my-py-agui-agent',
      protocol: 'ag-ui',
      infra: 'agentcore',
      iac: 'inherit',
    },
  ];
  for (const agent of pyAgents) {
    await pyAgentGenerator(tree, { ...agent, ...defaults });
  }
  await pyProjectGenerator(tree, {
    name: 'py-langchain-project',
    type: 'application',
    ...projectDefaults,
  });
  const langchainAgents: PyAgentGeneratorSchema[] = [
    {
      project: 'py_langchain_project',
      name: 'my-py-langchain-agent',
      protocol: 'ag-ui',
      iac: 'inherit',
    },
    {
      project: 'py_langchain_project',
      name: 'my-py-langchain-http-agent',
      protocol: 'http',
      iac: 'inherit',
    },
    {
      project: 'py_langchain_project',
      name: 'my-py-langchain-a2a-agent',
      protocol: 'a2a',
      iac: 'inherit',
    },
  ];
  for (const agent of langchainAgents) {
    await pyAgentGenerator(tree, {
      ...agent,
      framework: 'langchain',
      infra: 'agentcore',
      ...defaults,
    });
  }

  // AgentCore gateways, including a parent fronting the first (chained), and
  // an http-protocol gateway fronting agent runtime targets.
  await agentcoreGatewayGenerator(tree, {
    name: 'my-gateway',
    iac: 'inherit',
    ...projectDefaults,
  });
  await agentcoreGatewayGenerator(tree, {
    name: 'parent-gateway',
    iac: 'inherit',
    ...projectDefaults,
  });
  await agentcoreGatewayGenerator(tree, {
    name: 'agent-gateway',
    protocol: 'http',
    iac: 'inherit',
    ...projectDefaults,
  });

  // AgentCore Harness, connected to both an iam-auth and a cognito-auth tRPC
  // api, so the generated /agui route + history procedure are exercised
  // under each auth mode the api supports.
  await agentcoreHarnessGenerator(tree, {
    name: 'my-harness',
    iac: 'inherit',
    ...projectDefaults,
  });

  // Databases — DynamoDB, plus Aurora across both engines and ORMs.
  await tsDynamoDBGenerator(tree, {
    name: 'my-table',
    framework: 'electrodb',
    infra: 'dynamodb',
    iac: 'inherit',
    ...projectDefaults,
  });
  await pyDynamoDBGenerator(tree, {
    name: 'my-py-table',
    framework: 'pynamodb',
    infra: 'dynamodb',
    iac: 'inherit',
    ...projectDefaults,
  });
  const tsRdbs: TsRdbGeneratorSchema[] = [
    {
      name: 'postgres-db',
      infra: 'aurora',
      engine: 'postgres',
      framework: 'prisma',
      iac: 'inherit',
    },
    {
      name: 'my-sql-db',
      infra: 'aurora',
      engine: 'mysql',
      framework: 'prisma',
      iac: 'inherit',
    },
  ];
  for (const rdb of tsRdbs) {
    await tsRdbGenerator(tree, { ...rdb, ...projectDefaults });
  }
  const pyRdbs: PyRdbGeneratorSchema[] = [
    {
      name: 'py-postgres-db',
      infra: 'aurora',
      engine: 'postgres',
      framework: 'sqlmodel',
      iac: 'inherit',
    },
    {
      name: 'py-mysql-db',
      infra: 'aurora',
      engine: 'mysql',
      framework: 'sqlmodel',
      iac: 'inherit',
    },
  ];
  for (const rdb of pyRdbs) {
    await pyRdbGenerator(tree, { ...rdb, ...projectDefaults });
  }

  // Every connection edge the matrix covers.
  const connections: ConnectionGeneratorSchema[] = [
    // Website -> API
    { sourceProject: ts('website'), targetProject: ts('my-api') },
    { sourceProject: ts('website-no-router'), targetProject: ts('my-api') },
    { sourceProject: 'website', targetProject: 'py_api' },
    { sourceProject: 'website', targetProject: 'my-smithy-api' },
    // Agent -> MCP server
    {
      sourceProject: 'ts-project',
      sourceComponent: 'agent',
      targetProject: 'ts-project',
      targetComponent: 'hosted-mcp-server',
    },
    {
      sourceProject: 'ts-project',
      sourceComponent: 'my-ts-agui-agent',
      targetProject: 'ts-project',
      targetComponent: 'hosted-mcp-server',
    },
    {
      sourceProject: 'ts-project',
      sourceComponent: 'agent',
      targetProject: 'py_project',
      targetComponent: 'my-mcp-server',
    },
    {
      sourceProject: 'py_project',
      sourceComponent: 'my-agent',
      targetProject: 'py_project',
      targetComponent: 'my-mcp-server',
    },
    {
      sourceProject: 'py_langchain_project',
      sourceComponent: 'my-py-langchain-agent',
      targetProject: 'py_project',
      targetComponent: 'my-mcp-server',
    },
    // HTTP agent <-> A2A agent
    {
      sourceProject: 'ts-project',
      sourceComponent: 'agent',
      targetProject: 'ts-project',
      targetComponent: 'my-ts-a2a-agent',
    },
    {
      sourceProject: 'ts-project',
      sourceComponent: 'agent',
      targetProject: 'py_project',
      targetComponent: 'my-py-a2a-agent',
    },
    {
      sourceProject: 'py_project',
      sourceComponent: 'my-agent',
      targetProject: 'ts-project',
      targetComponent: 'my-ts-a2a-agent',
    },
    {
      sourceProject: 'py_project',
      sourceComponent: 'my-agent',
      targetProject: 'py_project',
      targetComponent: 'my-py-a2a-agent',
    },
    {
      sourceProject: 'py_langchain_project',
      sourceComponent: 'my-py-langchain-agent',
      targetProject: 'py_project',
      targetComponent: 'my-py-a2a-agent',
    },
    // Agent -> gateway, gateway -> MCP server, gateway -> gateway
    {
      sourceProject: 'ts-project',
      sourceComponent: 'agent',
      targetProject: ts('my-gateway'),
    },
    {
      sourceProject: 'py_project',
      sourceComponent: 'my-agent',
      targetProject: ts('my-gateway'),
    },
    {
      sourceProject: 'py_langchain_project',
      sourceComponent: 'my-py-langchain-agent',
      targetProject: ts('my-gateway'),
    },
    {
      sourceProject: ts('my-gateway'),
      targetProject: 'ts-project',
      targetComponent: 'hosted-mcp-server',
    },
    {
      sourceProject: ts('my-gateway'),
      targetProject: 'py_project',
      targetComponent: 'my-mcp-server',
    },
    { sourceProject: ts('parent-gateway'), targetProject: ts('my-gateway') },
    // tRPC API -> AgentCore Harness (iam + cognito)
    { sourceProject: ts('my-api'), targetProject: ts('my-harness') },
    { sourceProject: ts('my-api-cognito'), targetProject: ts('my-harness') },
    // Gateway -> agent (http gateway fronting agent runtime targets: every
    // supported protocol permutation), then website -> gateway.
    {
      sourceProject: ts('agent-gateway'),
      targetProject: 'ts-project',
      targetComponent: 'my-ts-agui-agent',
    },
    {
      sourceProject: ts('agent-gateway'),
      targetProject: 'ts-project',
      targetComponent: 'my-ts-a2a-agent',
    },
    {
      sourceProject: ts('agent-gateway'),
      targetProject: 'py_project',
      targetComponent: 'my-py-agui-agent',
    },
    {
      sourceProject: ts('agent-gateway'),
      targetProject: 'py_project',
      targetComponent: 'my-agent',
    },
    {
      sourceProject: ts('agent-gateway'),
      targetProject: 'py_project',
      targetComponent: 'my-py-a2a-agent',
    },
    {
      sourceProject: ts('website-no-router'),
      targetProject: ts('agent-gateway'),
    },
    // Website -> agent
    {
      sourceProject: ts('website'),
      targetProject: 'ts-project',
      targetComponent: 'agent',
    },
    {
      sourceProject: ts('website'),
      targetProject: 'ts-project',
      targetComponent: 'my-ts-agui-agent',
    },
    {
      sourceProject: ts('website'),
      targetProject: 'py_project',
      targetComponent: 'my-agent',
    },
    {
      sourceProject: ts('website'),
      targetProject: 'py_project',
      targetComponent: 'my-py-agui-agent',
    },
    {
      sourceProject: ts('website'),
      targetProject: 'py_langchain_project',
      targetComponent: 'my-py-langchain-agent',
    },
    {
      sourceProject: ts('website'),
      targetProject: 'py_langchain_project',
      targetComponent: 'my-py-langchain-http-agent',
    },
    // DynamoDB
    { sourceProject: 'my-api', targetProject: ts('my-table') },
    { sourceProject: 'my-smithy-api', targetProject: ts('my-table') },
    {
      sourceProject: 'ts-project',
      sourceComponent: 'my-ts-agent',
      targetProject: ts('my-table'),
    },
    {
      sourceProject: 'ts-project',
      sourceComponent: 'my-mcp-server',
      targetProject: ts('my-table'),
    },
    { sourceProject: 'py_api', targetProject: 'my_py_table' },
    {
      sourceProject: 'py_project',
      sourceComponent: 'my-agent',
      targetProject: 'my_py_table',
    },
    {
      sourceProject: 'py_project',
      sourceComponent: 'my-mcp-server',
      targetProject: 'my_py_table',
    },
    {
      sourceProject: 'py_langchain_project',
      sourceComponent: 'my-py-langchain-http-agent',
      targetProject: 'my_py_table',
    },
    // Relational databases
    { sourceProject: 'py_api', targetProject: 'py_postgres_db' },
    {
      sourceProject: 'py_project',
      sourceComponent: 'my-agent',
      targetProject: 'py_postgres_db',
    },
    {
      sourceProject: 'py_project',
      sourceComponent: 'my-mcp-server',
      targetProject: 'py_postgres_db',
    },
  ];
  for (const connection of connections) {
    await connectionGenerator(tree, { ...connection, ...defaults });
  }

  // Licensing, then an Nx plugin with a custom generator.
  await licenseGenerator(tree, {
    license: 'Apache-2.0',
    copyrightHolder: 'Amazon.com, Inc. or its affiliates',
    ...defaults,
  });
  await tsNxPluginGenerator(tree, {
    ...projectDefaults,
    name: 'plugin',
    directory: 'tools',
  });
  await tsNxGeneratorGenerator(tree, {
    project: ts('plugin'),
    name: 'my#generator',
    ...defaults,
  });

  // A migration of each kind, so the scaffolded codemods compile and the
  // plugin's migrations.json (created by the first run) registers all three.
  const migrations: Omit<TsNxMigrationGeneratorSchema, 'project'>[] = [
    {
      name: 'rename-foo-target',
      description: 'Rename the foo target to bar',
    },
    {
      name: 'migrate-custom-handlers',
      description: 'Update custom handlers for the new API',
      kind: 'agentic',
    },
    {
      name: 'upgrade-framework',
      description: 'Upgrade the framework and reconcile call sites',
      kind: 'hybrid',
    },
  ];
  for (const migration of migrations) {
    await tsNxMigrationGenerator(tree, {
      ...migration,
      project: ts('plugin'),
      ...defaults,
    });
  }

  return () =>
    installDependencies(tree, preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
};

export default internalTestMatrixGenerator;
