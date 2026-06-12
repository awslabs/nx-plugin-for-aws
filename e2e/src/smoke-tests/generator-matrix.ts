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
 */
export const runGeneratorMatrix = async (opts: RunCliOpts) => {
  // Websites (with and without TanStack Router), plus auth on each.
  await runCLI(
    `generate @aws/nx-plugin:ts#website --name=website --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#website --name=website-no-router --tanstackRouter=false --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#astro-docs --name=docs-site --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#website#auth --project=@e2e-test/website --cognitoDomain=test --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#website#auth --project=@e2e-test/website-no-router --cognitoDomain=test-no-router --no-interactive`,
    opts,
  );

  // tRPC APIs — REST + HTTP variants.
  await runCLI(
    `generate @aws/nx-plugin:ts#api --name=my-api --infra=rest-lambda --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#api --name=my-api-http --infra=http-lambda --no-interactive`,
    opts,
  );

  // tRPC APIs with Custom auth — REST + HTTP variants.
  await runCLI(
    `generate @aws/nx-plugin:ts#api --name=my-api-custom --infra=rest-lambda --auth=custom --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#api --name=my-api-custom-http --infra=http-lambda --auth=custom --no-interactive`,
    opts,
  );

  // Website -> tRPC API connections
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=@e2e-test/my-api --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website-no-router --targetProject=@e2e-test/my-api --no-interactive`,
    opts,
  );

  // Python FastAPI — REST + HTTP variants.
  await runCLI(
    `generate @aws/nx-plugin:py#api --name=py-api --infra=rest-lambda --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#api --name=py-api-http --infra=http-lambda --no-interactive`,
    opts,
  );

  // Python FastAPI with Custom auth — REST + HTTP variants.
  await runCLI(
    `generate @aws/nx-plugin:py#api --name=py-api-custom --infra=rest-lambda --auth=custom --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#api --name=py-api-custom-http --infra=http-lambda --auth=custom --no-interactive`,
    opts,
  );

  // Python project + lambda function.
  await runCLI(
    `generate @aws/nx-plugin:py#project --name=py-project --projectType=application --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#lambda-function --project=e2e_test.py_project --name=my-function --event=Any --no-interactive`,
    opts,
  );

  // Python MCP + Strands agent (hosted on AgentCore).
  await runCLI(
    `generate @aws/nx-plugin:py#mcp-server --project=py_project --name=my-mcp-server --infra=agentcore --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#agent --project=py_project --name=my-agent --infra=agentcore --no-interactive`,
    opts,
  );

  // TypeScript project + lambda function.
  await runCLI(
    `generate @aws/nx-plugin:ts#project --name=ts-project --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#lambda-function --project=ts-project --name=my-function --event=Any --no-interactive`,
    opts,
  );

  // TypeScript MCP servers — uninfra'd (None) and hosted on AgentCore.
  await runCLI(
    `generate @aws/nx-plugin:ts#mcp-server --project=ts-project --name=my-mcp-server --infra=none --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#mcp-server --project=ts-project --name=hosted-mcp-server --infra=agentcore --no-interactive`,
    opts,
  );

  // TypeScript Strands agents — uninfra'd (None) and hosted (HTTP + A2A).
  await runCLI(
    `generate @aws/nx-plugin:ts#agent --project=ts-project --name=my-ts-agent --infra=none --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#agent --project=ts-project --infra=agentcore --no-interactive`,
    opts,
  );

  // A2A protocol agents (TypeScript + Python).
  await runCLI(
    `generate @aws/nx-plugin:ts#agent --project=ts-project --name=my-ts-a2a-agent --protocol=a2a --infra=agentcore --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#agent --project=py_project --name=my-py-a2a-agent --protocol=a2a --infra=agentcore --no-interactive`,
    opts,
  );

  // Cognito-auth variants to cover the A2A + Cognito permutation.
  await runCLI(
    `generate @aws/nx-plugin:ts#agent --project=ts-project --name=my-ts-a2a-agent-cognito --protocol=a2a --auth=cognito --infra=agentcore --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#agent --project=py_project --name=my-py-a2a-agent-cognito --protocol=a2a --auth=cognito --infra=agentcore --no-interactive`,
    opts,
  );

  // AG-UI protocol agents (TypeScript and Python).
  await runCLI(
    `generate @aws/nx-plugin:ts#agent --project=ts-project --name=my-ts-agui-agent --protocol=ag-ui --infra=agentcore --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#agent --project=py_project --name=my-py-agui-agent --protocol=ag-ui --infra=agentcore --no-interactive`,
    opts,
  );

  // Website <-> FastAPI connection
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=website --targetProject=py_api --no-interactive`,
    opts,
  );

  // Smithy API + connection
  await runCLI(
    `generate @aws/nx-plugin:ts#api --framework=smithy --name=my-smithy-api --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=website --targetProject=my-smithy-api --no-interactive`,
    opts,
  );

  // Agent <-> MCP server connections.
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=agent --targetProject=ts-project --targetComponent=hosted-mcp-server --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=my-ts-agui-agent --targetProject=ts-project --targetComponent=hosted-mcp-server --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=agent --targetProject=py_project --targetComponent=my-mcp-server --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-agent --targetProject=py_project --targetComponent=my-mcp-server --no-interactive`,
    opts,
  );

  // HTTP agent <-> A2A agent connections (4 permutations)
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=agent --targetProject=ts-project --targetComponent=my-ts-a2a-agent --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=agent --targetProject=py_project --targetComponent=my-py-a2a-agent --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-agent --targetProject=ts-project --targetComponent=my-ts-a2a-agent --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-agent --targetProject=py_project --targetComponent=my-py-a2a-agent --no-interactive`,
    opts,
  );

  // AgentCore Gateway + the four connection edges (ts/py agent -> gateway,
  // gateway -> ts/py mcp-server) so each smoke test exercises a deployable
  // gateway with multiple MCP server targets fronting both agent runtimes.
  await runCLI(
    `generate @aws/nx-plugin:agentcore-gateway --name=my-gateway --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=agent --targetProject=@e2e-test/my-gateway --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=py_project --sourceComponent=my-agent --targetProject=@e2e-test/my-gateway --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/my-gateway --targetProject=ts-project --targetComponent=hosted-mcp-server --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/my-gateway --targetProject=py_project --targetComponent=my-mcp-server --no-interactive`,
    opts,
  );

  // Website -> agent connections (TypeScript HTTP, TypeScript AG-UI, Python HTTP, Python AG-UI/CopilotKit)
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=ts-project --targetComponent=agent --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=ts-project --targetComponent=my-ts-agui-agent --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=py_project --targetComponent=my-agent --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=py_project --targetComponent=my-py-agui-agent --no-interactive`,
    opts,
  );

  // DynamoDB table — iacProvider inherited.
  await runCLI(
    `generate @aws/nx-plugin:ts#dynamodb --name=my-table --no-interactive`,
    opts,
  );

  // DynamoDB connections — tRPC, Smithy, TS agent, TS MCP server.
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=my-api --targetProject=@e2e-test/my-table --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=my-smithy-api --targetProject=@e2e-test/my-table --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=my-ts-agent --targetProject=@e2e-test/my-table --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=my-mcp-server --targetProject=@e2e-test/my-table --no-interactive`,
    opts,
  );

  // Relational databases (Aurora + Prisma) — PostgreSQL and MySQL, iacProvider inherited.
  await runCLI(
    `generate @aws/nx-plugin:ts#rdb --name=postgres-db --infra=aurora --engine=postgres --framework=prisma --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#rdb --name=my-sql-db --infra=aurora --engine=mysql --framework=prisma --no-interactive`,
    opts,
  );

  await runCLI(`generate @aws/nx-plugin:license --no-interactive`, opts);

  // Nx plugin + a custom generator (pure TS, not tied to IaC provider)
  await runCLI(
    `generate @aws/nx-plugin:ts#nx-plugin --name=plugin --directory=tools --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#nx-generator --project=@e2e-test/plugin --name=my#generator --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @e2e-test/plugin:my#generator --exampleOption=test --no-interactive`,
    opts,
  );
};
