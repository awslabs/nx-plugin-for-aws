/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { runCLI, tmpProjPath } from '../utils';
import { join } from 'path';
import { AwsClient } from 'aws4fetch';
import { CloudFormation, StackStatus } from '@aws-sdk/client-cloudformation';
import { Lambda } from '@aws-sdk/client-lambda';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { runSmokeTest } from './smoke-test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// @ts-expect-error no types for virtual module
import { AgentCoreTrpcClient } from 'virtual:ts-template/ts/strands-agent/files/http/agent-core-trpc-client';

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
 * Helper function to invoke a tRPC API endpoint
 */
async function invokeTrpcApi(apiUrl: string, apiName: string): Promise<void> {
  const aws = await createAwsClient();
  console.log(`Testing ${apiName} at ${apiUrl}`);
  const input = encodeURIComponent(JSON.stringify({ message: 'test' }));
  const response = await aws.fetch(`${apiUrl}echo?input=${input}`);
  const data = await response.json();
  console.log(`${apiName} response:`, data);
  expect(data.result.data.result).toBe('test');
}

/**
 * Helper function to invoke a REST API endpoint (eg FastAPI or Smithy)
 */
async function invokeRestApi(apiUrl: string, apiName: string): Promise<void> {
  const aws = await createAwsClient();
  console.log(`Testing ${apiName} at ${apiUrl}`);
  const response = await aws.fetch(`${apiUrl}echo?message=test`);
  const data = await response.json();
  console.log(`${apiName} response:`, data);
  expect(data.message).toBe('test');
}

/**
 * Helper function to invoke an MCP server via Bedrock Agent Core Runtime
 */
async function invokeAgentCoreMcp(arn: string, mcpName: string): Promise<void> {
  const aws = await createAwsClient('bedrock-agentcore');
  console.log(`Testing ${mcpName} with ARN ${arn}`);

  const mcpUrl = buildAgentCoreUrl(arn);

  // Create MCP client with custom fetch
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    fetch: aws.fetch.bind(aws),
  });

  const client = new Client({
    name: 'test-client',
    version: '1.0.0',
  });

  await client.connect(transport);

  try {
    await client.ping();
    console.log(`Pinged MCP server ${mcpName}`);
  } finally {
    await client.close();
  }
}

/**
 * Helper function to invoke a Strands Agent via Bedrock Agent Core Runtime
 */
async function invokeAgentCoreAgent(
  arn: string,
  agentName: string,
  message = 'what is 3 + 5 - 2?',
): Promise<string> {
  const aws = await createAwsClient('bedrock-agentcore');
  console.log(`Testing ${agentName} with ARN ${arn}`);

  const agentUrl = buildAgentCoreUrl(arn);

  const response = await aws.fetch(agentUrl, {
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

  console.log('Agent Response chunks:', chunks);

  console.log(`${agentName} response status:`, response.status);
  expect(response.status).toBe(200);
  expect(chunks.length).toBeGreaterThan(0);
  expect(chunks.every((c) => typeof c.content === 'string')).toBe(true);
  console.log(`Successfully invoked ${agentName}`);
  return chunks.map((c) => c.content).join('');
}

async function invokeTrpcAgentCoreAgent(
  arn: string,
  agentName: string,
  message = 'what is 3 * 5 / 4?',
): Promise<string> {
  console.log(`Testing ${agentName} with ARN ${arn}`);

  // Dogfood our vended client
  const client = AgentCoreTrpcClient.withIamAuth({
    agentRuntimeArn: arn,
  });

  // Wait for any data, or an error
  const response = await new Promise<string>((resolve, reject) => {
    let responseMessage = '';

    // NB the trpc api is generated code so we don't have a type-safe trpc client here
    (client.invoke as any).subscribe(
      { message },
      {
        onData: (chunk: string) => {
          console.log(chunk);
          responseMessage += chunk;
        },
        onComplete: () => resolve(responseMessage),
        onError: (error: any) => reject(error),
      },
    );
  });
  console.log('Agent Response', response);
  expect(response).not.toHaveLength(0);
  return response;
}

/**
 * Helper function to invoke an A2A server via Bedrock AgentCore Runtime.
 *
 * Uses the A2A SDK's `ClientFactory` with a SigV4-signing fetch for both the
 * agent card resolver and the JSON-RPC transport — this exercises the same
 * code path that `A2AAgent.clientFactory` uses inside generated agents.
 */
async function invokeAgentCoreA2a(
  arn: string,
  agentName: string,
): Promise<void> {
  // Lazy imports so these SDKs are only required in tests that need them
  const {
    ClientFactory,
    ClientFactoryOptions,
    DefaultAgentCardResolver,
    JsonRpcTransportFactory,
  } = await import('@a2a-js/sdk/client');

  console.log(`Testing ${agentName} with ARN ${arn}`);

  const region = process.env.AWS_REGION || 'us-west-2';
  const encodedArn = encodeURIComponent(arn);
  // AgentCore mounts A2A at the /invocations/ root (trailing slash matters).
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

  // NB: `cardResolver` must be passed to the ClientFactory directly —
  // `ClientFactoryOptions.createFrom` does not thread it through.
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
  });
  console.log('Status code', res.StatusCode);
  expect(res.StatusCode).toBe(200);
  console.log(`Successfully invoked ${lambdaName}`);
}

/**
 * Helper function to check that the website has been deployed
 */
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
 * Delete any CloudFormation stacks matching the test run prefix that were
 * not cleaned up by cdk destroy.
 *
 * The Website construct creates a cross-region WAF WebACL stack in us-east-1.
 * When the Application stack deploy fails, cdk destroy only tears down the
 * Application stack and skips the WAF stack, leaving orphaned WebACLs that
 * accumulate towards the NUM_WEBACLS_BY_ACCOUNT limit.
 */
async function deleteLeftoverStacks(cdkStageName: string): Promise<void> {
  const regions = [process.env.AWS_REGION || 'us-west-2', 'us-east-1'];
  const uniqueRegions = [...new Set(regions)];

  for (const region of uniqueRegions) {
    const cfn = new CloudFormation({ region });
    try {
      const stacks = await cfn.listStacks({
        StackStatusFilter: [
          StackStatus.CREATE_COMPLETE,
          StackStatus.UPDATE_COMPLETE,
          StackStatus.ROLLBACK_COMPLETE,
        ],
      });
      const leftoverStacks = (stacks.StackSummaries ?? []).filter((s) =>
        s.StackName?.startsWith(cdkStageName),
      );
      for (const stack of leftoverStacks) {
        console.log(
          `Deleting leftover stack ${stack.StackName} (${stack.StackStatus}) in ${region}`,
        );
        await cfn
          .deleteStack({ StackName: stack.StackName })
          .catch((e) =>
            console.warn(`Failed to delete stack ${stack.StackName}: ${e}`),
          );
      }
    } catch (e) {
      console.warn(`Failed to list stacks in ${region}: ${e}`);
    }
  }
}

/**
 * A test which deploys the smoke test resources to aws
 */
describe('smoke test - cdk-deploy', () => {
  const pkgMgr = 'npm';
  const targetDir = `${tmpProjPath()}/cdk-deploy-${pkgMgr}`;

  beforeEach(() => {
    console.log(`Cleaning target directory ${targetDir}`);
    if (existsSync(targetDir)) {
      rmSync(targetDir, { force: true, recursive: true });
    }
    ensureDirSync(targetDir);
  });

  it('should generate and build', async () => {
    const { opts } = await runSmokeTest(targetDir, pkgMgr);

    // Generate an 8 digit alphanumeric random testRunId
    const testRunId = Math.random().toString(36).substring(2, 10);

    // Copy our updated cdk app which ensures resources are all deleted on destroy and stack names don't clash
    const templateContent = readFileSync(
      join(__dirname, '../files/cdk-deploy/main.ts.template'),
      'utf-8',
    );
    const mainContent = templateContent.replace(
      /<% TEST_RUN_ID %>/g,
      testRunId,
    );
    writeFileSync(`${opts.cwd}/packages/infra/src/main.ts`, mainContent);

    const cdkStageName = `e2e-test-infra-sandbox-${testRunId}`;

    try {
      // Deploy the e2e test resources
      await runCLI(
        `deploy infra ${cdkStageName}/* --output-style=stream`,
        opts,
      );

      const cfn = new CloudFormation();

      const outputs =
        (
          await cfn.describeStacks({
            StackName: `${cdkStageName}-Application`,
          })
        ).Stacks?.[0]?.Outputs ?? [];

      // Helper function to find cloudformation output value by key prefix
      const findOutput = (keyPrefix: string): string => {
        const output = outputs.find((o) => o.OutputKey?.startsWith(keyPrefix));
        if (!output?.OutputValue) {
          throw new Error(`Output with key prefix ${keyPrefix} not found`);
        }
        return output.OutputValue;
      };

      // tRPC
      await invokeTrpcApi(findOutput('MyApiEndpoint'), 'tRPC REST API');
      await invokeTrpcApi(findOutput('MyApiHttpMyApiHttpUrl'), 'tRPC HTTP API');

      // FastAPI
      await invokeRestApi(findOutput('PyApiEndpoint'), 'FastAPI REST');
      await invokeRestApi(findOutput('PyApiHttpPyApiHttpUrl'), 'FastAPI HTTP');

      // Smithy
      await invokeRestApi(findOutput('MySmithyApiEndpoint'), 'Smithy REST');

      // MCP
      await invokeAgentCoreMcp(
        findOutput('TsMcpServerArn'),
        'TypeScript MCP Server',
      );
      await invokeAgentCoreMcp(
        findOutput('PyMcpServerArn'),
        'Python MCP Server',
      );

      // Agent
      await invokeAgentCoreAgent(
        findOutput('StrandsAgentArn'),
        'Strands Agent',
      );
      await invokeTrpcAgentCoreAgent(
        findOutput('TsStrandsAgentArn'),
        'TypeScript Strands Agent',
      );

      // A2A agents — invoke via the A2A JSON-RPC message/send method over
      // SigV4 against the AgentCore runtime URL.
      await invokeAgentCoreA2a(
        findOutput('TsA2aAgentArn'),
        'TypeScript A2A Agent',
      );
      await invokeAgentCoreA2a(findOutput('PyA2aAgentArn'), 'Python A2A Agent');

      // A2A connection generators — the HTTP host agents have vended A2A
      // clients for each A2A target, and the Agent tools array has the
      // generated delegate tools. Prompt the host to invoke each delegate
      // and assert it succeeds (proving the a2a-connection code path works
      // end-to-end on AgentCore with SigV4 between two deployed agents).
      // Tool names follow the generator's convention: `ask<TargetClassName>`
      // for TS, `ask_<target_snake_case>` for Python.
      await invokeTrpcAgentCoreAgent(
        findOutput('TsStrandsAgentArn'),
        'TS Agent -> TS A2A (via askMyTsA2aAgent)',
        'Use the askMyTsA2aAgent tool to ask the remote agent what 5 * 4 is. Return just the answer.',
      );
      await invokeTrpcAgentCoreAgent(
        findOutput('TsStrandsAgentArn'),
        'TS Agent -> PY A2A (via askMyPyA2aAgent)',
        'Use the askMyPyA2aAgent tool to ask the remote agent what 11 + 2 is. Return just the answer.',
      );
      await invokeAgentCoreAgent(
        findOutput('StrandsAgentArn'),
        'PY Agent -> TS A2A (via ask_my_ts_a2a_agent)',
        'Use the ask_my_ts_a2a_agent tool to ask the remote agent what 9 - 3 is. Return just the answer.',
      );
      await invokeAgentCoreAgent(
        findOutput('StrandsAgentArn'),
        'PY Agent -> PY A2A (via ask_my_py_a2a_agent)',
        'Use the ask_my_py_a2a_agent tool to ask the remote agent what 7 + 8 is. Return just the answer.',
      );

      // Lambda functions
      await invokeLambda(findOutput('PyFunctionArn'), 'Python Function');
      await invokeLambda(findOutput('TsFunctionArn'), 'TypeScript Function');

      // Website
      await pingWebsite(findOutput('WebsiteDistributionDomainName'));
    } finally {
      try {
        await runCLI(
          `destroy infra ${cdkStageName}/* --output-style=stream --force`,
          opts,
        );
      } catch (e) {
        console.warn(`cdk destroy failed (will still clean up): ${e}`);
      }
      // cdk destroy skips cross-region stacks (e.g. WAF in us-east-1) when
      // the main stack is in ROLLBACK_COMPLETE. Clean up any leftovers.
      await deleteLeftoverStacks(cdkStageName);
    }
  });
});
