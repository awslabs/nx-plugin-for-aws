/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import fastGlob from 'fast-glob';
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

/**
 * Read Terraform outputs as JSON from the infra project.
 *
 * We shell out directly (rather than going through `nx output`) to avoid the
 * nx cache potentially serving a stale value from a previous run.
 */
function readTerraformOutputs(projectRoot: string): Record<string, string> {
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

    // 8-digit alphanumeric test run id — used to make per-test state keys
    // and every hardcoded resource name unique so concurrent PR runs and
    // retries after a failed destroy don't collide on `EntityAlreadyExists`.
    const testRunId = Math.random().toString(36).substring(2, 10);

    // Overwrite the scaffolded main.tf with our wiring template (the
    // Terraform analogue of the `application-stack.ts.template` the
    // cdk-deploy test uses).
    const mainTfTemplate = readFileSync(
      join(__dirname, '../files/terraform-deploy/main.tf.template'),
      'utf-8',
    );
    writeFileSync(
      `${opts.cwd}/packages/infra/src/main.tf`,
      mainTfTemplate.replace(/<% TEST_RUN_ID %>/g, testRunId),
    );

    // Patch the infra project targets:
    // - `init`: use a per-run state key so concurrent PR runs don't share state
    // - `destroy`: auto-approve for unattended teardown
    const infraProjectJsonPath = `${opts.cwd}/packages/infra/project.json`;
    const infraProjectJson = JSON.parse(
      readFileSync(infraProjectJsonPath, 'utf-8'),
    );
    infraProjectJson.targets.init.configurations.dev.command =
      infraProjectJson.targets.init.configurations.dev.command.replace(
        /e2e-test-infra\/dev\/terraform\.tfstate/,
        `e2e-test-infra-${testRunId}/dev/terraform.tfstate`,
      );
    writeFileSync(
      infraProjectJsonPath,
      JSON.stringify(infraProjectJson, null, 2),
    );

    // Enable auto-sync so generated files (license headers on the new
    // main.tf, ts path aliases etc.) don't block the `apply` / `destroy`
    // pipeline with a fatal "workspace is out of sync" error.
    const nxJsonPath = `${opts.cwd}/nx.json`;
    const nxJson = JSON.parse(readFileSync(nxJsonPath, 'utf-8'));
    nxJson.sync = { ...(nxJson.sync ?? {}), applyChanges: true };
    writeFileSync(nxJsonPath, JSON.stringify(nxJson, null, 2));

    // Patch the generated Cognito user pool module so `terraform destroy`
    // can actually remove it between test runs. The shipped module sets
    // deletion_protection = ACTIVE which requires a two-step teardown.
    const identityTfPath = `${opts.cwd}/packages/common/terraform/src/core/user-identity/identity/identity.tf`;
    writeFileSync(
      identityTfPath,
      readFileSync(identityTfPath, 'utf-8').replace(
        /deletion_protection\s*=\s*"ACTIVE"/,
        'deletion_protection = "INACTIVE"',
      ),
    );

    // Inject `testRunId` into every hardcoded resource name in the generated
    // app modules. The generators produce module-internal names like
    // `api_name = "MyApi"`, `function_name = "MyApiHandler"`,
    // `application_name = "MyAgent-runtime-config"` etc. — without a
    // per-run suffix, concurrent test runs (or a retry after a failed
    // destroy) collide on "EntityAlreadyExists". We mirror the CDK
    // `testRunId` approach by suffixing every hardcoded name here.
    const rewriteNamesInFile = (
      path: string,
      rewrites: [RegExp, string][],
    ): void => {
      let content = readFileSync(path, 'utf-8');
      for (const [pattern, replacement] of rewrites) {
        content = content.replace(pattern, replacement);
      }
      writeFileSync(path, content);
    };

    // Agent/MCP modules: suffix `application_name` and `agent_runtime_name`.
    // AgentCore runtime names are limited to 1-43 chars matching
    // `^[a-zA-Z][a-zA-Z0-9_]{0,42}$` — suffix with `_${testRunId}`.
    for (const tfPath of fastGlob.sync(
      `${opts.cwd}/packages/common/terraform/src/app/{agents,mcp-servers}/*/*.tf`,
    )) {
      rewriteNamesInFile(tfPath, [
        [
          /application_name\s*=\s*"([^"]+)"/,
          `application_name = "$1-${testRunId}"`,
        ],
        [
          /agent_runtime_name\s*=\s*"([^"]+)"/,
          `agent_runtime_name = "$1_${testRunId}"`,
        ],
      ]);
    }

    // API modules (REST + HTTP): suffix `api_name` and the hardcoded
    // per-api Lambda/IAM/log-group/KMS/S3-bucket names.
    for (const tfPath of fastGlob.sync(
      `${opts.cwd}/packages/common/terraform/src/app/apis/*/*.tf`,
    )) {
      const content = readFileSync(tfPath, 'utf-8');
      const apiNameMatch = content.match(/api_name\s*=\s*"([^"]+)"/);
      if (!apiNameMatch) continue;
      const oldApiName = apiNameMatch[1];
      const newApiName = `${oldApiName}-${testRunId}`;
      rewriteNamesInFile(tfPath, [
        [
          new RegExp(`api_name\\s*=\\s*"${oldApiName}"`),
          `api_name = "${newApiName}"`,
        ],
        [
          new RegExp(`api_description\\s*=\\s*"${oldApiName} ([^"]+)"`),
          `api_description = "${newApiName} $1"`,
        ],
        [
          new RegExp(`function_name\\s*=\\s*"${oldApiName}Handler"`),
          `function_name = "${newApiName}Handler"`,
        ],
        [
          new RegExp(`name\\s*=\\s*"${oldApiName}Handler-execution-role"`),
          `name = "${newApiName}Handler-execution-role"`,
        ],
        [
          new RegExp(`name\\s*=\\s*"${oldApiName}Handler-additional-policies"`),
          `name = "${newApiName}Handler-additional-policies"`,
        ],
        [
          new RegExp(`name\\s*=\\s*"${oldApiName}Authorizer"`),
          `name = "${newApiName}Authorizer"`,
        ],
        [
          new RegExp(`name\\s*=\\s*"/aws/lambda/${oldApiName}Handler"`),
          `name = "/aws/lambda/${newApiName}Handler"`,
        ],
        [
          new RegExp(`value\\s*=\\s*\\{ "${oldApiName}" = ([^ }]+)`),
          `value = { "${newApiName}" = $1`,
        ],
        [
          new RegExp(`application_name\\s*=\\s*"${oldApiName}-runtime-config"`),
          `application_name = "${newApiName}-runtime-config"`,
        ],
      ]);
    }

    try {
      // Apply workspace sync so the newly-written main.tf and patched
      // project.json get their license headers. Nx in non-interactive mode
      // won't auto-apply sync changes during `apply` — it aborts with a
      // fatal "workspace is out of sync" error instead.
      await runCLI(`sync`, opts);

      // One-time remote-state bootstrap (idempotent — the target re-uses
      // any existing tfstate already in the per-account/region bucket).
      await runCLI(`bootstrap infra --output-style=stream`, opts);

      // Plan + apply end to end. The generated appconfig/entry modules
      // now write per-entry `local_file` resources into
      // `dist/…/runtime-config/entries/<namespace>/`, and the appconfig
      // module aggregates those via a `null_resource` at apply time —
      // so there's no longer a consistency race across the graph walk.
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
      // serves tRPC on its AgentCore runtime (not the plain HTTP
      // `/invocations` contract), so invoke it via the tRPC helper.
      await invokeAgentCoreAgent(outputs.strands_agent_arn, 'Strands Agent');
      await invokeTrpcAgentCoreAgent(
        outputs.ts_strands_agent_arn,
        'TypeScript Strands Agent',
      );

      // A2A (direct invocation via A2A SDK)
      await invokeAgentCoreA2a(
        outputs.ts_a2a_agent_arn,
        'TypeScript A2A Agent',
      );
      await invokeAgentCoreA2a(outputs.py_a2a_agent_arn, 'Python A2A Agent');

      // A2A-via-delegate-tool — mirrors the CDK smoke test. The HTTP host
      // agents resolve downstream agent ARNs from AppConfig; terraform's
      // generated appconfig module now deep-merges leaf entry files into
      // the two well-known namespaces at apply time, so the host agents
      // can find their connected A2A targets end-to-end.
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
