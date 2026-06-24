/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDirSync } from 'fs-extra';

import { runCLI, tmpProjPath } from '../utils';
import {
  invokeAgentCoreA2a,
  invokeAgentCoreAgent,
  invokeAgentCoreAgUi,
  invokeAgentCoreGatewayTool,
  invokeAgentCoreMcp,
  invokeCustomAuthApi,
  invokeCustomAuthTrpcApi,
  invokeLambda,
  invokeRestApi,
  invokeTrpcAgentCoreAgent,
  invokeTrpcApi,
  pingWebsite,
} from './deploy-invocations';
import { ensureRdsServiceLinkedRole } from './deploy-prerequisites';
import { runTerraformSmokeTest } from './terraform-smoke-test';
import {
  type AgentSpec,
  createCognitoTestUser,
  installChromium,
  runWebsiteIntegrationTest,
  writeIntegrationTestPage,
} from './website-integration';

// The APIs the deploy website is connected to (runtime-config 'apis' keys).
const WEBSITE_APIS = ['MyApi', 'PyApi', 'MySmithyApi'];

// The agents the deploy website is connected to, with the class names under
// which they appear in the website's runtime-config / vended hooks.
const WEBSITE_AGENTS: AgentSpec[] = [
  { kind: 'ts-http', className: 'TsProjectAgent' },
  { kind: 'ts-agui', className: 'MyTsAguiAgent' },
  { kind: 'py-http', className: 'MyAgent' },
  { kind: 'py-agui', className: 'MyPyAguiAgent' },
  // LangChain agent (AG-UI protocol) — same framework-agnostic AG-UI client.
  { kind: 'py-agui', className: 'MyPyLangchainAgent' },
];

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

interface TerraformDeployVariant {
  /** Suffix appended to the smoke-test name and target directory. */
  variant: 'terraform-deploy' | 'terraform-deploy-rdb';
  /** Path (relative to e2e/src/files) of the main.tf template to use. */
  mainTfTemplate: string;
  /** Whether the variant requires the RDS service-linked role. */
  requiresRdsServiceLinkedRole: boolean;
}

const runTerraformDeployVariant = (config: TerraformDeployVariant) => {
  const pkgMgr = 'pnpm';
  const targetDir = `${tmpProjPath()}/${config.variant}-${pkgMgr}`;

  describe(`smoke test - ${config.variant}`, () => {
    beforeEach(() => {
      console.log(`Cleaning target directory ${targetDir}`);
      if (existsSync(targetDir)) {
        rmSync(targetDir, { force: true, recursive: true });
      }
      ensureDirSync(targetDir);
    });

    it('should generate, deploy, exercise and destroy', async () => {
      const { opts } = await runTerraformSmokeTest(
        targetDir,
        pkgMgr,
        undefined,
        // Add the browser-driven integration-test page to the website before
        // the build so it is bundled into the deployed site. Only the
        // application variant deploys the website.
        config.variant === 'terraform-deploy'
          ? async (projectRoot) => {
              writeIntegrationTestPage(
                `${projectRoot}/packages/website`,
                WEBSITE_APIS,
                WEBSITE_AGENTS,
              );
              await installChromium();
            }
          : undefined,
      );

      // Per-run suffix used in the Terraform state key so concurrent runs
      // don't share state.
      const testRunId = Math.random().toString(36).substring(2, 10);

      // Overwrite the scaffolded main.tf with the wiring template (Terraform
      // analogue of the `application-stack.ts.template` cdk-deploy uses).
      const mainTfTemplate = readFileSync(
        join(__dirname, '../files', config.mainTfTemplate),
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
        TF_ENV: `${config.variant}-${testRunId}`,
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
      if (existsSync(identityTfPath)) {
        writeFileSync(
          identityTfPath,
          readFileSync(identityTfPath, 'utf-8').replace(
            /deletion_protection\s*=\s*"ACTIVE"/,
            'deletion_protection = "INACTIVE"',
          ),
        );
      }

      if (config.requiresRdsServiceLinkedRole) {
        ensureRdsServiceLinkedRole();
      }

      try {
        await runCLI(`sync`, opts);
        await runCLI(`bootstrap infra --output-style=stream`, opts);
        await runCLI(`apply infra --output-style=stream`, opts);

        if (config.variant === 'terraform-deploy') {
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

          // Custom auth APIs — should deny unauthenticated requests
          await invokeCustomAuthTrpcApi(
            outputs.my_api_custom_endpoint,
            'tRPC REST Custom Auth',
          );
          await invokeCustomAuthTrpcApi(
            outputs.my_api_custom_http_endpoint,
            'tRPC HTTP Custom Auth',
          );
          await invokeCustomAuthApi(
            outputs.py_api_custom_endpoint,
            'FastAPI REST Custom Auth',
          );
          await invokeCustomAuthApi(
            outputs.py_api_custom_http_endpoint,
            'FastAPI HTTP Custom Auth',
          );

          // MCP
          await invokeAgentCoreMcp(
            outputs.ts_mcp_server_arn,
            'TypeScript MCP Server',
          );
          await invokeAgentCoreMcp(
            outputs.py_mcp_server_arn,
            'Python MCP Server',
          );

          // Agents — direct invocation. The TypeScript agent
          // serves tRPC on AgentCore, so invoke it via the tRPC helper.
          await invokeAgentCoreAgent(outputs.py_agent_arn, 'Python Agent');
          await invokeTrpcAgentCoreAgent(
            outputs.ts_agent_arn,
            'TypeScript Agent',
          );
          // Python LangChain agents across all three protocols.
          await invokeAgentCoreAgUi(
            outputs.py_langchain_agent_arn,
            'Python LangChain Agent (AG-UI)',
          );
          await invokeAgentCoreAgent(
            outputs.py_langchain_http_agent_arn,
            'Python LangChain Agent (HTTP)',
          );

          // A2A (direct)
          await invokeAgentCoreA2a(
            outputs.ts_a2a_agent_arn,
            'TypeScript A2A Agent',
          );
          await invokeAgentCoreA2a(
            outputs.py_a2a_agent_arn,
            'Python A2A Agent',
          );
          await invokeAgentCoreA2a(
            outputs.py_langchain_a2a_agent_arn,
            'Python LangChain A2A Agent',
          );

          // A2A via delegate tool (host agent -> A2A target)
          await invokeTrpcAgentCoreAgent(
            outputs.ts_agent_arn,
            'TS Agent -> TS A2A (via askMyTsA2aAgent)',
            'Use the askMyTsA2aAgent tool to ask the remote agent what 5 * 4 is. Return just the answer.',
          );
          await invokeTrpcAgentCoreAgent(
            outputs.ts_agent_arn,
            'TS Agent -> PY A2A (via askMyPyA2aAgent)',
            'Use the askMyPyA2aAgent tool to ask the remote agent what 11 + 2 is. Return just the answer.',
          );
          await invokeAgentCoreAgent(
            outputs.py_agent_arn,
            'PY Agent -> TS A2A (via ask_my_ts_a2a_agent)',
            'Use the ask_my_ts_a2a_agent tool to ask the remote agent what 9 - 3 is. Return just the answer.',
          );
          await invokeAgentCoreAgent(
            outputs.py_agent_arn,
            'PY Agent -> PY A2A (via ask_my_py_a2a_agent)',
            'Use the ask_my_py_a2a_agent tool to ask the remote agent what 7 + 8 is. Return just the answer.',
          );

          // AgentCore Gateway — both HTTP agents are granted invoke access to
          // the gateway, which fronts the TypeScript (`hosted-mcp-server`) and
          // Python (`my-mcp-server`) MCP servers as targets. Prompt each agent
          // to call a gateway-prefixed tool (`<target>___<tool>`) for each
          // upstream server. A successful round-trip proves agent -> deployed
          // Gateway (Cedar ENFORCE + SigV4) -> MCP server works end-to-end for
          // both languages.
          expect(
            await invokeTrpcAgentCoreAgent(
              outputs.ts_agent_arn,
              'TS Agent -> Gateway -> TS MCP (hosted-mcp-server___divide)',
              'Use the hosted-mcp-server___divide tool to divide 6 by 2. Return just the number.',
            ),
          ).toContain('3');
          expect(
            await invokeTrpcAgentCoreAgent(
              outputs.ts_agent_arn,
              'TS Agent -> Gateway -> PY MCP (my-mcp-server___add)',
              'Use the my-mcp-server___add tool to add 6 and 2. Return just the number.',
            ),
          ).toContain('8');
          expect(
            await invokeAgentCoreAgent(
              outputs.py_agent_arn,
              'PY Agent -> Gateway -> TS MCP (hosted-mcp-server___divide)',
              'Use the hosted-mcp-server___divide tool to divide 6 by 2. Return just the number.',
            ),
          ).toContain('3');
          expect(
            await invokeAgentCoreAgent(
              outputs.py_agent_arn,
              'PY Agent -> Gateway -> PY MCP (my-mcp-server___add)',
              'Use the my-mcp-server___add tool to add 6 and 2. Return just the number.',
            ),
          ).toContain('8');

          // Chained gateways — the parent gateway fronts my_gateway via the
          // gateway -> gateway connection, re-exposing its tools under a
          // second prefix. Listing tools on the parent and calling one proves
          // the parent -> my_gateway (SigV4 + Cedar at both hops) -> MCP
          // server chain works end-to-end.
          await invokeAgentCoreGatewayTool(
            outputs.parent_gateway_url,
            'Parent Gateway -> Gateway -> TS MCP',
            'my-gateway___hosted-mcp-server___divide',
            { a: 6, b: 2 },
            '3',
          );

          // Lambda functions
          await invokeLambda(outputs.py_function_arn, 'Python Function');
          await invokeLambda(outputs.ts_function_arn, 'TypeScript Function');

          // Website
          await pingWebsite(outputs.website_distribution_domain_name);

          // Browser-driven website integration: log in via the Cognito hosted
          // UI and drive the website's vended clients to invoke every connected
          // API and agent from a real browser.
          const login = await createCognitoTestUser(
            outputs.user_pool_id,
            outputs.user_pool_client_id,
          );
          await runWebsiteIntegrationTest({
            baseUrl: `https://${outputs.website_distribution_domain_name}`,
            expectedApis: WEBSITE_APIS,
            expectedAgents: WEBSITE_AGENTS,
            login,
          });
        }
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
};

// terraform-deploy — application surface (APIs, agents, MCP, lambdas, website).
runTerraformDeployVariant({
  variant: 'terraform-deploy',
  mainTfTemplate: 'terraform-deploy/main.tf.template',
  requiresRdsServiceLinkedRole: false,
});

// terraform-deploy-rdb — relational databases only (PostgreSQL + MySQL
// Aurora clusters with a dedicated VPC). Splitting these out keeps the
// main terraform-deploy variant under the IAM session limit, since
// Aurora cluster create + destroy plus VPC ENI cleanup for the
// migration/credential Lambdas dominates the runtime.
runTerraformDeployVariant({
  variant: 'terraform-deploy-rdb',
  mainTfTemplate: 'terraform-deploy/main-rdb.tf.template',
  requiresRdsServiceLinkedRole: true,
});
