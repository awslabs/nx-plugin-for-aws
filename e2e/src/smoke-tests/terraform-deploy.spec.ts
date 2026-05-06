/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { join } from 'path';

import { runCLI, tmpProjPath } from '../utils';
import { runTerraformSmokeTest } from './terraform-smoke-test';
import {
  invokeAgentCoreA2a,
  invokeAgentCoreAgent,
  invokeAgentCoreMcp,
  invokeLambda,
  invokeRestApi,
  invokeTrpcAgentCoreAgent,
  invokeTrpcApi,
  pingWebsite,
} from './deploy-invocations';

function readTerraformOutputs(projectRoot: string): Record<string, string> {
  // Read outputs directly (not via `nx output`) to avoid nx cache serving a stale value.
  const raw = execSync('terraform output -json', {
    cwd: join(projectRoot, 'packages/infra/src'),
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
  });
  const parsed = JSON.parse(raw) as Record<
    string,
    { value: unknown; type: unknown }
  >;
  return Object.fromEntries(
    Object.entries(parsed).map(([k, v]) => [k, String(v.value)]),
  );
}

describe('smoke test - terraform-deploy', () => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/terraform-deploy-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('should generate, deploy, exercise and destroy', async () => {
    const { opts } = await runTerraformSmokeTest(targetDir, pkgMgr);

    // Per-run suffix used in the Terraform state key so concurrent runs
    // don't share state.
    const testRunId = Math.random().toString(36).substring(2, 10);

    // Overwrite the scaffolded main.tf with the wiring template (Terraform
    // analogue of the `application-stack.ts.template` cdk-deploy uses).
    const mainTfTemplate = readFileSync(
      join(__dirname, '../files/terraform-deploy/main.tf.template'),
      'utf-8',
    );
    writeFileSync(
      `${opts.cwd}/packages/infra/src/main.tf`,
      mainTfTemplate.replace(/<% TEST_RUN_ID %>/g, testRunId),
    );

    // Per-run Terraform state key — the generated `init.ts` uses the
    // `TF_ENV` env var as the state-key leaf, so giving each run a
    // distinct TF_ENV value isolates its state from concurrent runs.
    const infraProjectJsonPath = `${opts.cwd}/packages/infra/project.json`;
    const infraProjectJson = JSON.parse(
      readFileSync(infraProjectJsonPath, 'utf-8'),
    );
    infraProjectJson.targets.init.configurations.dev.env = {
      ...(infraProjectJson.targets.init.configurations.dev.env ?? {}),
      TF_ENV: `dev-${testRunId}`,
    };
    writeFileSync(
      infraProjectJsonPath,
      JSON.stringify(infraProjectJson, null, 2),
    );

    // Auto-apply sync so the main.tf + project.json rewrites don't block
    // `apply` with a fatal "workspace is out of sync" error.
    const nxJsonPath = `${opts.cwd}/nx.json`;
    const nxJson = JSON.parse(readFileSync(nxJsonPath, 'utf-8'));
    nxJson.sync = { ...(nxJson.sync ?? {}), applyChanges: true };
    writeFileSync(nxJsonPath, JSON.stringify(nxJson, null, 2));

    // Cognito deletion_protection = INACTIVE so `terraform destroy` can
    // remove the user pool in one pass.
    const identityTfPath = `${opts.cwd}/packages/common/terraform/src/core/user-identity/identity/identity.tf`;
    writeFileSync(
      identityTfPath,
      readFileSync(identityTfPath, 'utf-8').replace(
        /deletion_protection\s*=\s*"ACTIVE"/,
        'deletion_protection = "INACTIVE"',
      ),
    );

    try {
      await runCLI(`sync`, opts);
      await runCLI(`bootstrap infra --output-style=stream`, opts);
      await runCLI(`apply infra --output-style=stream`, opts);

      const outputs = readTerraformOutputs(opts.cwd);
      console.log('Terraform outputs:', outputs);

      // tRPC
      await invokeTrpcApi(outputs.my_api_endpoint, 'tRPC REST API');
      await invokeTrpcApi(outputs.my_api_http_endpoint, 'tRPC HTTP API');

      // FastAPI
      await invokeRestApi(outputs.py_api_endpoint, 'FastAPI REST');
      await invokeRestApi(outputs.py_api_http_endpoint, 'FastAPI HTTP');

      // Smithy
      await invokeRestApi(outputs.my_smithy_api_endpoint, 'Smithy REST');

      // MCP
      await invokeAgentCoreMcp(
        outputs.ts_mcp_server_arn,
        'TypeScript MCP Server',
      );
      await invokeAgentCoreMcp(outputs.py_mcp_server_arn, 'Python MCP Server');

      // Strands agents — direct invocation. The TypeScript strands agent
      // serves tRPC on AgentCore, so invoke it via the tRPC helper.
      await invokeAgentCoreAgent(outputs.strands_agent_arn, 'Strands Agent');
      await invokeTrpcAgentCoreAgent(
        outputs.ts_strands_agent_arn,
        'TypeScript Strands Agent',
      );

      // A2A (direct)
      await invokeAgentCoreA2a(
        outputs.ts_a2a_agent_arn,
        'TypeScript A2A Agent',
      );
      await invokeAgentCoreA2a(outputs.py_a2a_agent_arn, 'Python A2A Agent');

      // A2A via delegate tool (host agent -> A2A target)
      await invokeTrpcAgentCoreAgent(
        outputs.ts_strands_agent_arn,
        'TS Agent -> TS A2A (via askMyTsA2aAgent)',
        'Use the askMyTsA2aAgent tool to ask the remote agent what 5 * 4 is. Return just the answer.',
      );
      await invokeTrpcAgentCoreAgent(
        outputs.ts_strands_agent_arn,
        'TS Agent -> PY A2A (via askMyPyA2aAgent)',
        'Use the askMyPyA2aAgent tool to ask the remote agent what 11 + 2 is. Return just the answer.',
      );
      await invokeAgentCoreAgent(
        outputs.strands_agent_arn,
        'PY Agent -> TS A2A (via ask_my_ts_a2a_agent)',
        'Use the ask_my_ts_a2a_agent tool to ask the remote agent what 9 - 3 is. Return just the answer.',
      );
      await invokeAgentCoreAgent(
        outputs.strands_agent_arn,
        'PY Agent -> PY A2A (via ask_my_py_a2a_agent)',
        'Use the ask_my_py_a2a_agent tool to ask the remote agent what 7 + 8 is. Return just the answer.',
      );

      // Lambda functions
      await invokeLambda(outputs.py_function_arn, 'Python Function');
      await invokeLambda(outputs.ts_function_arn, 'TypeScript Function');

      // Website
      await pingWebsite(outputs.website_distribution_domain_name);
    } finally {
      try {
        await runCLI(
          `destroy infra --output-style=stream -- -auto-approve`,
          opts,
        );
      } catch (e) {
        console.warn(`terraform destroy failed (will still clean up): ${e}`);
      }
    }
  });
});
