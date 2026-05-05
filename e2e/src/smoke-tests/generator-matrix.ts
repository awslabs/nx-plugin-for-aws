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
 * must cover. Generators inherit the `iacProvider` selected when the
 * workspace was created, so there's a single place to add a new generator
 * and both the `cdk-deploy` and `terraform-deploy` e2e pipelines exercise it.
 */
export const runGeneratorMatrix = async (opts: RunCliOpts) => {
  // React websites (with and without TanStack Router), plus auth on each.
  await runCLI(
    `generate @aws/nx-plugin:ts#react-website --name=website --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#react-website --name=website-no-router --enableTanstackRouter=false --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#astro-docs --name=docs-site --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#react-website#auth --project=@e2e-test/website --cognitoDomain=test --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#react-website#auth --project=@e2e-test/website-no-router --cognitoDomain=test-no-router --no-interactive`,
    opts,
  );

  // tRPC APIs — REST + HTTP variants.
  await runCLI(
    `generate @aws/nx-plugin:ts#trpc-api --name=my-api --computeType=ServerlessApiGatewayRestApi --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#trpc-api --name=my-api-http --computeType=ServerlessApiGatewayHttpApi --no-interactive`,
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
    `generate @aws/nx-plugin:py#fast-api --name=py-api --computeType=ServerlessApiGatewayRestApi --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#fast-api --name=py-api-http --computeType=ServerlessApiGatewayHttpApi --no-interactive`,
    opts,
  );

  // Python project + lambda function.
  await runCLI(
    `generate @aws/nx-plugin:py#project --name=py-project --projectType=application --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#lambda-function --project=e2e_test.py_project --functionName=my-function --eventSource=Any --no-interactive`,
    opts,
  );

  // Python MCP + Strands agent (hosted on AgentCore).
  await runCLI(
    `generate @aws/nx-plugin:py#mcp-server --project=py_project --name=my-mcp-server --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#strands-agent --project=py_project --name=my-agent --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );

  // TypeScript project + lambda function.
  await runCLI(
    `generate @aws/nx-plugin:ts#project --name=ts-project --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#lambda-function --project=ts-project --functionName=my-function --eventSource=Any --no-interactive`,
    opts,
  );

  // TypeScript MCP servers — uninfra'd (None) and hosted on AgentCore.
  await runCLI(
    `generate @aws/nx-plugin:ts#mcp-server --project=ts-project --name=my-mcp-server --computeType=None --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#mcp-server --project=ts-project --name=hosted-mcp-server --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );

  // TypeScript Strands agents — uninfra'd (None) and hosted (HTTP + A2A).
  await runCLI(
    `generate @aws/nx-plugin:ts#strands-agent --project=ts-project --name=my-ts-agent --computeType=None --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#strands-agent --project=ts-project --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );

  // A2A protocol agents (TypeScript + Python).
  await runCLI(
    `generate @aws/nx-plugin:ts#strands-agent --project=ts-project --name=my-ts-a2a-agent --protocol=A2A --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#strands-agent --project=py_project --name=my-py-a2a-agent --protocol=A2A --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );

  // Cognito-auth variants to cover the A2A + Cognito permutation.
  await runCLI(
    `generate @aws/nx-plugin:ts#strands-agent --project=ts-project --name=my-ts-a2a-agent-cognito --protocol=A2A --auth=Cognito --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#strands-agent --project=py_project --name=my-py-a2a-agent-cognito --protocol=A2A --auth=Cognito --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );

  // AG-UI protocol agent (Python only — TypeScript AG-UI is not yet supported).
  await runCLI(
    `generate @aws/nx-plugin:py#strands-agent --project=py_project --name=my-py-agui-agent --protocol=AG-UI --computeType=BedrockAgentCoreRuntime --no-interactive`,
    opts,
  );

  // Website <-> FastAPI connection
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=website --targetProject=py_api --no-interactive`,
    opts,
  );

  // Smithy API + connection
  await runCLI(
    `generate @aws/nx-plugin:ts#smithy-api --name=my-smithy-api --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=website --targetProject=my-smithy-api --no-interactive`,
    opts,
  );

  // Strands agent <-> MCP server connections.
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=ts-project --sourceComponent=agent --targetProject=ts-project --targetComponent=hosted-mcp-server --no-interactive`,
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

  // Website -> strands agent connections (TypeScript, Python HTTP, Python AG-UI/CopilotKit)
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=@e2e-test/website --targetProject=ts-project --targetComponent=agent --no-interactive`,
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
