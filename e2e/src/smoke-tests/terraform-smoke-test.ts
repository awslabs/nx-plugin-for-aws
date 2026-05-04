/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { buildCreateNxWorkspaceCommand, runCLI, tmpProjPath } from '../utils';
import { join } from 'path';
import { beforeEach, describe, it } from 'vitest';

/**
 * Runs the full matrix of generators against a Terraform-backed workspace.
 *
 * Mirrors the generator coverage in `smoke-test.ts` (which exercises CDK) so
 * that `terraform` and `terraform-deploy` smoke tests both verify the same
 * generators, options and connection permutations under the Terraform IaC
 * provider.
 */
export const runTerraformSmokeTest = async (
  dir: string,
  pkgMgr: string,
  onProjectCreate?: (projectRoot: string) => void,
) => {
  await runCLI(
    `${buildCreateNxWorkspaceCommand(pkgMgr, 'e2e-test', 'Terraform')} --interactive=false --skipGit`,
    {
      cwd: dir,
      prefixWithPackageManagerCmd: false,
      redirectStderr: true,
    },
  );
  const projectRoot = `${dir}/e2e-test`;
  const opts = {
    cwd: projectRoot,
    env: {
      NX_DAEMON: 'false',
      NODE_OPTIONS: '--max-old-space-size=8192',
    },
  };
  if (onProjectCreate) {
    onProjectCreate(projectRoot);
  }

  // Terraform application project that wires everything together.
  await runCLI(
    `generate @aws/nx-plugin:terraform#project --name=infra --type=application --no-interactive`,
    opts,
  );

  // React websites (with and without TanStack Router), plus auth on each.
  await runCLI(
    `generate @aws/nx-plugin:ts#react-website --name=website --iacProvider=Terraform --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#react-website --name=website-no-router --enableTanstackRouter=false --iacProvider=Terraform --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#astro-docs --name=docs-site --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#react-website#auth --project=@e2e-test/website --iacProvider=Terraform --cognitoDomain=test --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#react-website#auth --project=@e2e-test/website-no-router --iacProvider=Terraform --cognitoDomain=test-no-router --no-interactive`,
    opts,
  );

  // tRPC APIs — both REST and HTTP API Gateway variants.
  await runCLI(
    `generate @aws/nx-plugin:ts#trpc-api --name=my-api --computeType=ServerlessApiGatewayRestApi --iacProvider=Terraform --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#trpc-api --name=my-api-http --computeType=ServerlessApiGatewayHttpApi --iacProvider=Terraform --no-interactive`,
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

  // Python FastAPI — both REST and HTTP API Gateway variants.
  await runCLI(
    `generate @aws/nx-plugin:py#fast-api --name=py-api --computeType=ServerlessApiGatewayRestApi --iacProvider=Terraform --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#fast-api --name=py-api-http --computeType=ServerlessApiGatewayHttpApi --iacProvider=Terraform --no-interactive`,
    opts,
  );

  // Python project + lambda function.
  await runCLI(
    `generate @aws/nx-plugin:py#project --name=py-project --projectType=application --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#lambda-function --project=e2e_test.py_project --functionName=my-function --eventSource=Any --iacProvider=Terraform --no-interactive`,
    opts,
  );

  // Python MCP + Strands agent (hosted on AgentCore).
  await runCLI(
    `generate @aws/nx-plugin:py#mcp-server --project=py_project --name=my-mcp-server --computeType=BedrockAgentCoreRuntime --iacProvider=Terraform --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#strands-agent --project=py_project --name=my-agent --computeType=BedrockAgentCoreRuntime --iacProvider=Terraform --no-interactive`,
    opts,
  );

  // TypeScript project + lambda function.
  await runCLI(
    `generate @aws/nx-plugin:ts#project --name=ts-project --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#lambda-function --project=ts-project --functionName=my-function --eventSource=Any --iacProvider=Terraform --no-interactive`,
    opts,
  );

  // TypeScript MCP servers — uninfra'd (None) and hosted on AgentCore.
  await runCLI(
    `generate @aws/nx-plugin:ts#mcp-server --project=ts-project --name=my-mcp-server --computeType=None --iacProvider=Terraform --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#mcp-server --project=ts-project --name=hosted-mcp-server --computeType=BedrockAgentCoreRuntime --iacProvider=Terraform --no-interactive`,
    opts,
  );

  // TypeScript Strands agents — uninfra'd (None) and hosted (HTTP + A2A).
  await runCLI(
    `generate @aws/nx-plugin:ts#strands-agent --project=ts-project --name=my-ts-agent --computeType=None --iacProvider=Terraform --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:ts#strands-agent --project=ts-project --computeType=BedrockAgentCoreRuntime --iacProvider=Terraform --no-interactive`,
    opts,
  );

  // A2A protocol agents (TypeScript + Python).
  await runCLI(
    `generate @aws/nx-plugin:ts#strands-agent --project=ts-project --name=my-ts-a2a-agent --protocol=A2A --computeType=BedrockAgentCoreRuntime --iacProvider=Terraform --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#strands-agent --project=py_project --name=my-py-a2a-agent --protocol=A2A --computeType=BedrockAgentCoreRuntime --iacProvider=Terraform --no-interactive`,
    opts,
  );

  // Cognito-auth variants to cover the A2A + Cognito permutation for schema/build coverage.
  await runCLI(
    `generate @aws/nx-plugin:ts#strands-agent --project=ts-project --name=my-ts-a2a-agent-cognito --protocol=A2A --auth=Cognito --computeType=BedrockAgentCoreRuntime --iacProvider=Terraform --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:py#strands-agent --project=py_project --name=my-py-a2a-agent-cognito --protocol=A2A --auth=Cognito --computeType=BedrockAgentCoreRuntime --iacProvider=Terraform --no-interactive`,
    opts,
  );

  // AG-UI protocol agent (Python only — TypeScript AG-UI is not yet supported).
  await runCLI(
    `generate @aws/nx-plugin:py#strands-agent --project=py_project --name=my-py-agui-agent --protocol=AG-UI --computeType=BedrockAgentCoreRuntime --iacProvider=Terraform --no-interactive`,
    opts,
  );

  // Website <-> FastAPI connection
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=website --targetProject=py_api --no-interactive`,
    opts,
  );

  // Smithy API + connection
  await runCLI(
    `generate @aws/nx-plugin:ts#smithy-api --name=my-smithy-api --iacProvider=Terraform --no-interactive`,
    opts,
  );
  await runCLI(
    `generate @aws/nx-plugin:connection --sourceProject=website --targetProject=my-smithy-api --no-interactive`,
    opts,
  );

  // Strands agent <-> MCP server connections (mirror the CDK smoke test).
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

  // Since the smoke tests don't run in a git repo, we need to exclude some
  // patterns for the license sync.
  writeFileSync(
    `${opts.cwd}/aws-nx-plugin.config.mts`,
    readFileSync(
      join(__dirname, '../files/aws-nx-plugin.config.mts.template'),
      'utf-8',
    ),
  );

  await runCLI(`sync --verbose`, opts);
  await runCLI(
    `run-many --target build --all --output-style=stream --skip-nx-cache --verbose`,
    opts,
  );

  return { opts };
};

export interface TerraformSmokeTestOptions {
  /** Label for the describe block (defaults to `pkgMgr`). */
  variant?: string;
  onProjectCreate?: (projectRoot: string) => void;
}

export const terraformSmokeTest = (
  pkgMgr: string,
  options: TerraformSmokeTestOptions = {},
) => {
  const variant = options.variant ?? pkgMgr;
  describe(`smoke test - ${variant}`, () => {
    beforeEach(() => {
      const targetDir = `${tmpProjPath()}/${variant}-${pkgMgr}`;
      console.log(`Cleaning target directory ${targetDir}`);
      if (existsSync(targetDir)) {
        rmSync(targetDir, { force: true, recursive: true });
      }
      ensureDirSync(targetDir);
    });

    it(`Should generate and build - ${variant}`, async () => {
      await runTerraformSmokeTest(
        `${tmpProjPath()}/${variant}-${pkgMgr}`,
        pkgMgr,
        options.onProjectCreate,
      );
    });
  });
};
