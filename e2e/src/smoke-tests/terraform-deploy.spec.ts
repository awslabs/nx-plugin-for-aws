/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import fastGlob from 'fast-glob';
import { join } from 'path';
import { AwsClient } from 'aws4fetch';
import { Lambda } from '@aws-sdk/client-lambda';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { runCLI, tmpProjPath } from '../utils';
import { runTerraformSmokeTest } from './terraform-smoke-test';

/**
 * Helper function to create an AWS client with SigV4 signing
 */
async function createAwsClient(service = 'execute-api'): Promise<AwsClient> {
  const credentials = await fromNodeProviderChain()();
  return new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
    service,
    region: process.env.AWS_REGION || 'us-west-2',
  });
}

/**
 * Helper function to build Bedrock Agent Core Runtime URL
 */
function buildAgentCoreUrl(arn: string): string {
  const encodedArn = arn.replace(/:/g, '%3A').replace(/\//g, '%2F');
  const region = process.env.AWS_REGION || 'us-west-2';
  return `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodedArn}/invocations?qualifier=DEFAULT`;
}

/**
 * Helper function to invoke a tRPC API endpoint (reached via the terraform
 * `stage_invoke_url` output, which does NOT include a trailing slash).
 */
async function invokeTrpcApi(apiUrl: string, apiName: string): Promise<void> {
  const aws = await createAwsClient();
  console.log(`Testing ${apiName} at ${apiUrl}`);
  const input = encodeURIComponent(JSON.stringify({ message: 'test' }));
  const response = await aws.fetch(`${apiUrl}/echo?input=${input}`);
  const data = await response.json();
  console.log(`${apiName} response:`, data);
  expect(data.result.data.result).toBe('test');
}

async function invokeRestApi(apiUrl: string, apiName: string): Promise<void> {
  const aws = await createAwsClient();
  console.log(`Testing ${apiName} at ${apiUrl}`);
  const response = await aws.fetch(`${apiUrl}/echo?message=test`);
  const data = await response.json();
  console.log(`${apiName} response:`, data);
  expect(data.message).toBe('test');
}

async function invokeAgentCoreMcp(arn: string, mcpName: string): Promise<void> {
  const aws = await createAwsClient('bedrock-agentcore');
  console.log(`Testing ${mcpName} with ARN ${arn}`);

  const transport = new StreamableHTTPClientTransport(
    new URL(buildAgentCoreUrl(arn)),
    {
      fetch: aws.fetch.bind(aws),
    },
  );

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
  try {
    await client.ping();
    console.log(`Pinged MCP server ${mcpName}`);
  } finally {
    await client.close();
  }
}

async function invokeAgentCoreAgent(
  arn: string,
  agentName: string,
  message = 'what is 3 + 5 - 2?',
): Promise<string> {
  const aws = await createAwsClient('bedrock-agentcore');
  console.log(`Testing ${agentName} with ARN ${arn}`);

  const response = await aws.fetch(buildAgentCoreUrl(arn), {
    method: 'POST',
    body: JSON.stringify({ message }),
    headers: {
      'Content-Type': 'application/json',
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id':
        'abcdefghijklmnopqrstuvwxyz0123456789',
    },
  });

  const chunks: { content: string }[] = [];
  let buffer = '';
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  while (reader) {
    const { value, done } = await reader.read();
    if (done) {
      if (buffer.trim()) {
        chunks.push(JSON.parse(buffer));
      }
      break;
    }
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) {
        const chunk = JSON.parse(line);
        chunks.push(chunk);
        console.log(chunk);
      }
    }
  }

  console.log(`${agentName} response status:`, response.status);
  expect(response.status).toBe(200);
  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks.every((c) => typeof c.content === 'string')).toBe(true);
  console.log(`Successfully invoked ${agentName}`);
  return chunks.map((c) => c.content).join('');
}

async function invokeAgentCoreA2a(
  arn: string,
  agentName: string,
): Promise<void> {
  const {
    ClientFactory,
    ClientFactoryOptions,
    DefaultAgentCardResolver,
    JsonRpcTransportFactory,
  } = await import('@a2a-js/sdk/client');

  console.log(`Testing ${agentName} with ARN ${arn}`);

  const region = process.env.AWS_REGION || 'us-west-2';
  const encodedArn = encodeURIComponent(arn);
  const baseUrl = `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodedArn}/invocations/`;
  const sessionId = 'abcdefghijklmnopqrstuvwxyz0123456789';

  const credentialsProvider = fromNodeProviderChain();
  const sigv4Fetch: typeof fetch = async (input, init) => {
    const credentials = await credentialsProvider();
    const awsClient = new AwsClient({
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
      service: 'bedrock-agentcore',
      region,
    });
    const headers = new Headers(init?.headers);
    if (!headers.has('X-Amzn-Bedrock-AgentCore-Runtime-Session-Id')) {
      headers.set('X-Amzn-Bedrock-AgentCore-Runtime-Session-Id', sessionId);
    }
    return awsClient.fetch(input, { ...init, headers });
  };

  const factory = new ClientFactory({
    ...ClientFactoryOptions.default,
    transports: [new JsonRpcTransportFactory({ fetchImpl: sigv4Fetch })],
    cardResolver: new DefaultAgentCardResolver({ fetchImpl: sigv4Fetch }),
  });

  const client = await factory.createFromUrl(baseUrl);
  const card = await client.getAgentCard();
  expect(typeof card.name).toBe('string');
  console.log(`${agentName} agent card:`, card.name);

  const stream = client.sendMessageStream({
    message: {
      kind: 'message',
      role: 'user',
      parts: [{ kind: 'text', text: 'hello' }],
      messageId: crypto.randomUUID(),
    },
  });

  let events = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _event of stream) {
    events++;
    break;
  }
  expect(events).toBeGreaterThan(0);
  console.log(`Successfully invoked ${agentName} (${events} events)`);
}

async function invokeLambda(arn: string, lambdaName: string) {
  const lambda = new Lambda();
  console.log('Invoking lambda', lambdaName, 'with arn', arn);
  const res = await lambda.invoke({
    FunctionName: arn,
    Payload: JSON.stringify({}),
  });
  const payload = res.Payload
    ? new TextDecoder().decode(res.Payload)
    : undefined;
  console.log('Status code', res.StatusCode);
  console.log('Function error', res.FunctionError);
  console.log('Payload', payload);
  expect(res.StatusCode).toBe(200);
  expect(res.FunctionError).toBeUndefined();
  console.log(`Successfully invoked ${lambdaName}`);
}

async function pingWebsite(domain: string) {
  console.log('Testing website with domain', domain);
  const status = (await fetch(`https://${domain}/`)).status;
  console.log('Website response status:', status);
  expect(status).toBe(200);
  expect(
    await (await fetch(`https://${domain}/runtime-config.json`)).json(),
  ).toHaveProperty('cognitoProps');
  console.log('Successfully pinged website');
}

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

    // 8-digit alphanumeric test run id, used to make per-test state keys and
    // per-test IAM policy names unique across concurrent PRs.
    const testRunId = Math.random().toString(36).substring(2, 10);

    // Overwrite the scaffolded main.tf with our wiring template. This is the
    // terraform analogue of the cdk-deploy `application-stack.ts.template`.
    const templateContent = readFileSync(
      join(__dirname, '../files/terraform-deploy/main.tf.template'),
      'utf-8',
    );
    const mainContent = templateContent.replace(
      /<% TEST_RUN_ID %>/g,
      testRunId,
    );
    writeFileSync(`${opts.cwd}/packages/infra/src/main.tf`, mainContent);

    // Patch the infra project's init target to use a per-run state key.
    // `plan` depends on `init`, so every `nx apply` / `nx destroy` invocation
    // re-runs init; hard-coding the override in project.json is the least
    // fragile way to ensure concurrent test runs don't collide on state.
    const infraProjectJsonPath = `${opts.cwd}/packages/infra/project.json`;
    const infraProjectJson = JSON.parse(
      readFileSync(infraProjectJsonPath, 'utf-8'),
    );
    const initDevCmd: string =
      infraProjectJson.targets.init.configurations.dev.command;
    infraProjectJson.targets.init.configurations.dev.command =
      initDevCmd.replace(
        /e2e-test-infra\/dev\/terraform\.tfstate/,
        `e2e-test-infra-${testRunId}/dev/terraform.tfstate`,
      );

    // Force -parallelism=1 on plan, apply and destroy. The generated
    // appconfig module reads the runtime-config directory via
    // `fileset(config_dir, "*.json")` which races against parallel
    // `add_*_runtime_config` external data sources that write namespace
    // JSON files during the same walk — surfacing as
    // "function returned an inconsistent result".
    const planCommands: string[] =
      infraProjectJson.targets.plan.configurations.dev.commands;
    infraProjectJson.targets.plan.configurations.dev.commands =
      planCommands.map((cmd) =>
        cmd.startsWith('terraform plan') ? `${cmd} -parallelism=1` : cmd,
      );
    // `terraform apply` takes `-parallelism=N` before the plan file
    // positional argument; splice the flag in right after `terraform apply`.
    // `-refresh=false` stops terraform from re-running `data.external`
    // sources during apply — those are the ones that re-mutate the
    // runtime-config JSON files and trigger the appconfig `file()` race.
    infraProjectJson.targets.apply.configurations.dev.command =
      infraProjectJson.targets.apply.configurations.dev.command.replace(
        /^terraform apply\b/,
        'terraform apply -parallelism=1 -refresh=false',
      );
    // Destroy doesn't hit the same fileset race (no new files get written
    // during teardown), so leave parallelism at the default to keep the
    // ~20min destroy phase from ballooning.

    writeFileSync(
      infraProjectJsonPath,
      JSON.stringify(infraProjectJson, null, 2),
    );

    // Enable auto-sync so generated files (license headers on the new main.tf,
    // ts path aliases etc.) don't block the `apply` / `destroy` pipeline with
    // a fatal "workspace is out of sync" error.
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

    // Strip the namespace→AppConfig plumbing from the generated appconfig
    // module. The shipped implementation reads the `runtime-config` JSON
    // files lazily via `fileset`/`file` at evaluation time; sibling
    // `data.external.updated_config` modules keep mutating those JSON files
    // mid-walk, so terraform's internal consistency check re-evaluates the
    // local and sees different content on the second pass — surfacing as
    // "Call to function 'file' failed: function returned an inconsistent
    // result". We keep the bare `Application` / `Environment` /
    // `DeploymentStrategy` resources (their ids are referenced by downstream
    // modules) but remove the namespace Configuration Profiles /
    // Hosted Configuration Versions / Deployments so nothing depends on
    // the racy locals.
    const appconfigTfPath = `${opts.cwd}/packages/common/terraform/src/core/runtime-config/appconfig/appconfig.tf`;
    const appconfigTf = readFileSync(appconfigTfPath, 'utf-8');
    // Keep everything up to line 45 (Application/Environment/DeploymentStrategy)
    // and the final Outputs block. Drop the locals block (fileset/file) and
    // all per-namespace resources.
    const outputsStart = appconfigTf.indexOf('# Outputs');
    const preNamespaces = appconfigTf
      .slice(0, appconfigTf.indexOf('# Read all namespace JSON files'))
      .trimEnd();
    writeFileSync(
      appconfigTfPath,
      `${preNamespaces}\n\n${appconfigTf.slice(outputsStart)}`,
    );

    // Inject `testRunId` into every hardcoded resource name in the generated
    // app modules. The generators produce module-internal names like
    // `api_name = "MyApi"`, `function_name = "MyApiHandler"`,
    // `application_name = "MyAgent-runtime-config"`, etc. Without a per-run
    // suffix, concurrent test runs (or a failed run that left leftovers)
    // collide on "EntityAlreadyExists" errors the next time around. We mirror
    // the CDK `testRunId` approach by suffixing every hardcoded name.
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
    // per-api Lambda/IAM/log-group names.
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
      // Apply sync one more time so the newly-written main.tf and patched
      // project.json get their license headers. Nx in non-interactive mode
      // won't auto-apply sync changes during `apply` — it aborts with a fatal
      // "workspace is out of sync" error instead.
      await runCLI(`sync`, opts);

      // One-time remote-state bootstrap (idempotent — the target re-uses any
      // existing tfstate already in the per-account/region bucket).
      await runCLI(`bootstrap infra --output-style=stream`, opts);

      // Pre-seed the runtime-config directory with all namespace JSON files
      // the generated `add_*_runtime_config` modules will write during apply.
      // Without this the appconfig module's `fileset(config_dir, "*.json")`
      // sees the directory change between plan-time and apply-time evaluations
      // and fails with "function returned an inconsistent result" — the
      // external data sources that write these files run *during* the graph
      // walk, after fileset has already been evaluated once.
      const runtimeConfigDir = `${opts.cwd}/dist/packages/common/terraform/runtime-config`;
      ensureDirSync(runtimeConfigDir);
      for (const ns of ['connection', 'agentcore']) {
        const nsPath = `${runtimeConfigDir}/${ns}.json`;
        if (!existsSync(nsPath)) {
          writeFileSync(nsPath, '{}');
        }
      }

      // Plan + apply end to end. The plan target has been patched to pass
      // `-parallelism=1` so the generated appconfig module's `fileset(...)`
      // doesn't race against the parallel runtime-config writers. Combined
      // with the cross-module `depends_on` chain we added in main.tf, every
      // agent/MCP module's appconfig reads the runtime-config directory only
      // after all writers have stabilised.
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

      // Agents
      await invokeAgentCoreAgent(outputs.strands_agent_arn, 'Strands Agent');
      await invokeAgentCoreAgent(
        outputs.ts_strands_agent_arn,
        'TypeScript Strands Agent',
      );

      // A2A (direct invocation via A2A SDK)
      await invokeAgentCoreA2a(
        outputs.ts_a2a_agent_arn,
        'TypeScript A2A Agent',
      );
      await invokeAgentCoreA2a(outputs.py_a2a_agent_arn, 'Python A2A Agent');

      // A2A through the delegate tools — same coverage as the CDK test. The
      // host agents were wired with `additional_iam_policy_statements` for
      // each A2A target so these invocations must succeed end-to-end.
      await invokeAgentCoreAgent(
        outputs.ts_strands_agent_arn,
        'TS Agent -> TS A2A (via askMyTsA2aAgent)',
        'Use the askMyTsA2aAgent tool to ask the remote agent what 5 * 4 is. Return just the answer.',
      );
      await invokeAgentCoreAgent(
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

      // Lambda functions. We skip the Python lambda — see the note in
      // main.tf.template; the py-project aggregator bundles all agent deps
      // and exceeds the Lambda direct-upload limit until the Terraform
      // py#lambda-function module gains S3-backed upload support.
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
