/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { runCLI } from '../utils';

interface RunCliOpts {
  cwd: string;
  env: Record<string, string>;
}

/**
 * Runs the generator matrix that both the CDK and Terraform smoke tests
 * must cover. Generators inherit the `iac` selected when the
 * workspace was created, so there's a single place to add a new generator
 * and both the `cdk-deploy` and `terraform-deploy` e2e pipelines exercise it.
 *
 * By default every generator runs with `--prefer-install-dependencies=false`
 * so the dependency install happens once (via `runInstall` after the matrix)
 * rather than after every generator. Generators still install on their own when
 * skipping would leave a graph-critical dependency unresolvable (e.g. a website
 * whose generated `vite.config.mts` imports `@tailwindcss/vite`), so the next
 * generator can still compute the Nx project graph.
 *
 * Pass `{ preferInstallDependencies: true }` to install after every generator
 * instead — the idempotency test needs this so lockfiles (including `uv.lock`)
 * are fully synced before it snapshots the workspace.
 */
export const runGeneratorMatrix = async (
  opts: RunCliOpts,
  {
    preferInstallDependencies = false,
  }: { preferInstallDependencies?: boolean } = {},
) => {
  const deferFlag = preferInstallDependencies
    ? ''
    : ' --prefer-install-dependencies=false';
  // Websites (with and without TanStack Router), plus auth on each.
  await runCLI(
    `generate @aws/nx-plugin:ts#website --name=website --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#website --name=website-no-router --tanstackRouter=false --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#astro-docs --name=docs-site --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#website#auth --project=@e2e-test/website --cognitoDomain=test --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#website#auth --project=@e2e-test/website-no-router --cognitoDomain=test-no-router --no-interactive${deferFlag}`,
    opts,
  );

  // tRPC APIs — REST + HTTP variants.
  await runCLI(
    `generate @aws/nx-plugin:ts#api --name=my-api --infra=rest-lambda --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#api --name=my-api-http --infra=http-lambda --no-interactive${deferFlag}`,
    opts,
  );

  // tRPC APIs with Custom auth — REST + HTTP variants.
  await runCLI(
    `generate @aws/nx-plugin:ts#api --name=my-api-custom --infra=rest-lambda --auth=custom --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#api --name=my-api-custom-http --infra=http-lambda --auth=custom --no-interactive${deferFlag}`,
    opts,
  );

  // Website -> tRPC API connections
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=@e2e-test/my-api --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website-no-router --targetProject=@e2e-test/my-api --no-interactive${deferFlag}`,
    opts,
  );

  // Python FastAPI — REST + HTTP variants.
  await runCLI(
    `generate @aws/nx-plugin:py#api --name=py-api --infra=rest-lambda --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#api --name=py-api-http --infra=http-lambda --no-interactive${deferFlag}`,
    opts,
  );

  // Python FastAPI with Custom auth — REST + HTTP variants.
  await runCLI(
    `generate @aws/nx-plugin:py#api --name=py-api-custom --infra=rest-lambda --auth=custom --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#api --name=py-api-custom-http --infra=http-lambda --auth=custom --no-interactive${deferFlag}`,
    opts,
  );

  // Python project + lambda function.
  await runCLI(
    `generate @aws/nx-plugin:py#project --name=py-project --projectType=application --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#lambda-function --project=e2e_test.py_project --name=my-function --event=Any --no-interactive${deferFlag}`,
    opts,
  );

  // Python MCP + Strands agent (hosted on AgentCore).
  await runCLI(
    `generate @aws/nx-plugin:py#mcp-server --project=py_project --name=my-mcp-server --infra=agentcore --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#agent --project=py_project --name=my-agent --infra=agentcore --no-interactive${deferFlag}`,
    opts,
  );

  // TypeScript project + lambda function.
  await runCLI(
    `generate @aws/nx-plugin:ts#project --name=ts-project --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#lambda-function --project=ts-project --name=my-function --event=Any --no-interactive${deferFlag}`,
    opts,
  );

  // TypeScript MCP servers — uninfra'd (None) and hosted on AgentCore.
  await runCLI(
    `generate @aws/nx-plugin:ts#mcp-server --project=ts-project --name=my-mcp-server --infra=none --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#mcp-server --project=ts-project --name=hosted-mcp-server --infra=agentcore --no-interactive${deferFlag}`,
    opts,
  );

  // OAuth DCR proxy for Cognito-authenticated MCP servers — iacProvider inherited.
  await runCLI(
    `generate @aws/nx-plugin:ts#dcr-proxy --name=my-dcr-proxy --no-interactive${deferFlag}`,
    opts,
  );

  // TypeScript Strands agents — uninfra'd (None) and hosted (HTTP + A2A).
  await runCLI(
    `generate @aws/nx-plugin:ts#agent --project=ts-project --name=my-ts-agent --infra=none --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#agent --project=ts-project --infra=agentcore --no-interactive${deferFlag}`,
    opts,
  );

  // A2A protocol agents (TypeScript + Python).
  await runCLI(
    `generate @aws/nx-plugin:ts#agent --project=ts-project --name=my-ts-a2a-agent --protocol=a2a --infra=agentcore --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#agent --project=py_project --name=my-py-a2a-agent --protocol=a2a --infra=agentcore --no-interactive${deferFlag}`,
    opts,
  );

  // Cognito-auth variants to cover the A2A + Cognito permutation.
  await runCLI(
    `generate @aws/nx-plugin:ts#agent --project=ts-project --name=my-ts-a2a-agent-cognito --protocol=a2a --auth=cognito --infra=agentcore --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#agent --project=py_project --name=my-py-a2a-agent-cognito --protocol=a2a --auth=cognito --infra=agentcore --no-interactive${deferFlag}`,
    opts,
  );

  // AG-UI protocol agents (TypeScript Strands, Python Strands, Python LangChain).
  await runCLI(
    `generate @aws/nx-plugin:ts#agent --project=ts-project --name=my-ts-agui-agent --protocol=ag-ui --infra=agentcore --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#agent --project=py_project --name=my-py-agui-agent --protocol=ag-ui --infra=agentcore --no-interactive${deferFlag}`,
    opts,
  );
  // Python LangChain agents across all three protocols, deployed on AgentCore so
  // the smoke tests cover building, bundling and deploying a langchain runtime.
  // LangChain pulls a large dependency closure (langchain + langgraph), so these
  // live in their own project — co-locating them with the zip-bundled
  // `py-project/my-function` Lambda would push that Lambda past the 250 MB
  // unzipped limit, since the bundle exports the whole package's deps.
  await runCLI(
    `generate @aws/nx-plugin:py#project --name=py-langchain-project --projectType=application --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#agent --project=py_langchain_project --name=my-py-langchain-agent --framework=langchain --protocol=ag-ui --infra=agentcore --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#agent --project=py_langchain_project --name=my-py-langchain-http-agent --framework=langchain --protocol=http --infra=agentcore --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#agent --project=py_langchain_project --name=my-py-langchain-a2a-agent --framework=langchain --protocol=a2a --infra=agentcore --no-interactive${deferFlag}`,
    opts,
  );

  // Website <-> FastAPI connection
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=website --targetProject=py_api --no-interactive${deferFlag}`,
    opts,
  );

  // Smithy API + connection
  await runCLI(
    `generate @aws/nx-plugin:ts#api --framework=smithy --name=my-smithy-api --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=website --targetProject=my-smithy-api --no-interactive${deferFlag}`,
    opts,
  );

  // Agent <-> MCP server connections.
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=agent --targetProject=ts-project --targetComponent=hosted-mcp-server --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=my-ts-agui-agent --targetProject=ts-project --targetComponent=hosted-mcp-server --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=agent --targetProject=py_project --targetComponent=my-mcp-server --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-agent --targetProject=py_project --targetComponent=my-mcp-server --no-interactive${deferFlag}`,
    opts,
  );
  // LangChain agent -> Python MCP server (langchain-mcp-adapters tool loading).
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_langchain_project --sourceComponent=my-py-langchain-agent --targetProject=py_project --targetComponent=my-mcp-server --no-interactive${deferFlag}`,
    opts,
  );

  // HTTP agent <-> A2A agent connections (4 permutations)
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=agent --targetProject=ts-project --targetComponent=my-ts-a2a-agent --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=agent --targetProject=py_project --targetComponent=my-py-a2a-agent --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-agent --targetProject=ts-project --targetComponent=my-ts-a2a-agent --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-agent --targetProject=py_project --targetComponent=my-py-a2a-agent --no-interactive${deferFlag}`,
    opts,
  );
  // LangChain (AG-UI) agent -> Python A2A agent: delegates to a remote agent as
  // a langchain tool (reusing the framework-agnostic A2A transport).
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_langchain_project --sourceComponent=my-py-langchain-agent --targetProject=py_project --targetComponent=my-py-a2a-agent --no-interactive${deferFlag}`,
    opts,
  );

  // AgentCore Gateway + the four connection edges (ts/py agent -> gateway,
  // gateway -> ts/py mcp-server) so each smoke test exercises a deployable
  // gateway with multiple MCP server targets fronting both agent runtimes.
  await runCLI(
    `generate @aws/nx-plugin:agentcore-gateway --name=my-gateway --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=agent --targetProject=@e2e-test/my-gateway --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-agent --targetProject=@e2e-test/my-gateway --no-interactive${deferFlag}`,
    opts,
  );
  // LangChain agent -> gateway (langchain gateway MCP client).
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_langchain_project --sourceComponent=my-py-langchain-agent --targetProject=@e2e-test/my-gateway --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/my-gateway --targetProject=ts-project --targetComponent=hosted-mcp-server --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/my-gateway --targetProject=py_project --targetComponent=my-mcp-server --no-interactive${deferFlag}`,
    opts,
  );

  // A parent gateway fronting my-gateway, exercising the
  // gateway -> gateway connection edge (chained gateways).
  await runCLI(
    `generate @aws/nx-plugin:agentcore-gateway --name=parent-gateway --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/parent-gateway --targetProject=@e2e-test/my-gateway --no-interactive${deferFlag}`,
    opts,
  );

  // Website -> agent connections (TypeScript HTTP, TypeScript AG-UI, Python HTTP, Python AG-UI/CopilotKit)
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=ts-project --targetComponent=agent --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=ts-project --targetComponent=my-ts-agui-agent --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=py_project --targetComponent=my-agent --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=py_project --targetComponent=my-py-agui-agent --no-interactive${deferFlag}`,
    opts,
  );
  // Website -> Python LangChain (AG-UI/CopilotKit) agent.
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=py_langchain_project --targetComponent=my-py-langchain-agent --no-interactive${deferFlag}`,
    opts,
  );
  // Website -> Python LangChain HTTP agent (OpenAPI client, like the Strands
  // Python HTTP agent — exercises the langchain http protocol from the browser).
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=py_langchain_project --targetComponent=my-py-langchain-http-agent --no-interactive${deferFlag}`,
    opts,
  );

  // DynamoDB table — iacProvider inherited.
  await runCLI(
    `generate @aws/nx-plugin:ts#dynamodb --name=my-table --no-interactive${deferFlag}`,
    opts,
  );

  // DynamoDB connections — tRPC, Smithy, TS agent, TS MCP server.
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=my-api --targetProject=@e2e-test/my-table --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=my-smithy-api --targetProject=@e2e-test/my-table --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=my-ts-agent --targetProject=@e2e-test/my-table --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=my-mcp-server --targetProject=@e2e-test/my-table --no-interactive${deferFlag}`,
    opts,
  );

  // Python DynamoDB table — iacProvider inherited.
  await runCLI(
    `generate @aws/nx-plugin:py#dynamodb --name=my-py-table --no-interactive${deferFlag}`,
    opts,
  );

  // Python DynamoDB connections — FastAPI, py agent, py MCP server.
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_api --targetProject=my_py_table --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-agent --targetProject=my_py_table --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-mcp-server --targetProject=my_py_table --no-interactive${deferFlag}`,
    opts,
  );
  // LangChain agent -> DynamoDB table (framework-agnostic workspace + dev wiring).
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_langchain_project --sourceComponent=my-py-langchain-http-agent --targetProject=my_py_table --no-interactive${deferFlag}`,
    opts,
  );

  // Relational databases (Aurora + Prisma) — PostgreSQL and MySQL, iacProvider inherited.
  await runCLI(
    `generate @aws/nx-plugin:ts#rdb --name=postgres-db --infra=aurora --engine=postgres --framework=prisma --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#rdb --name=my-sql-db --infra=aurora --engine=mysql --framework=prisma --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#rdb --name=py-postgres-db --infra=aurora --engine=postgres --framework=sqlmodel --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#rdb --name=py-mysql-db --infra=aurora --engine=mysql --framework=sqlmodel --no-interactive${deferFlag}`,
    opts,
  );

  // Python RDB connections — FastAPI, py agent, py MCP server.
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_api --targetProject=py_postgres_db --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-agent --targetProject=py_postgres_db --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-mcp-server --targetProject=py_postgres_db --no-interactive${deferFlag}`,
    opts,
  );

  await runCLI(
    `generate @aws/nx-plugin:license --no-interactive${deferFlag}`,
    opts,
  );

  // Nx plugin + a custom generator (pure TS, not tied to IaC provider)
  await runCLI(
    `generate @aws/nx-plugin:ts#nx-plugin --name=plugin --directory=tools --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#nx-generator --project=@e2e-test/plugin --name=my#generator --no-interactive${deferFlag}`,
    opts,
  );
  await runCLI(
    `generate @e2e-test/plugin:my#generator --exampleOption=test --no-interactive${deferFlag}`,
    opts,
  );
};
