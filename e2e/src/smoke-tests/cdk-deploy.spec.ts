/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { ensureDirSync } from 'fs-extra';
import { runCLI, tmpProjPath } from '../utils';
import { join } from 'path';
import { AwsClient } from 'aws4fetch';
import { CloudFormation } from '@aws-sdk/client-cloudformation';
import { Lambda } from '@aws-sdk/client-lambda';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { runSmokeTest } from './smoke-test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// @ts-expect-error no types for virtual module
import { AgentCoreTrpcClient } from 'virtual:ts-template/ts/strands-agent/files/app/agent-core-trpc-client';

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
): Promise<void> {
  const aws = await createAwsClient('bedrock-agentcore');
  console.log(`Testing ${agentName} with ARN ${arn}`);

  const agentUrl = buildAgentCoreUrl(arn);

  const response = await aws.fetch(agentUrl, {
    method: 'POST',
    body: JSON.stringify({
      prompt: 'what is 3 + 5?',
      session_id: 'abcdefghijklmnopqrstuvwxyz0123456789',
    }),
    headers: {
      'Content-Type': 'application/json',
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
}

async function invokeTrpcAgentCoreAgent(
  arn: string,
  agentName: string,
): Promise<void> {
  console.log(`Testing ${agentName} with ARN ${arn}`);

  // Dogfood our vended client
  const client = AgentCoreTrpcClient.withIamAuth({
    agentRuntimeArn: arn,
  });

  // Wait for any data, or an error
  const response = await new Promise((resolve, reject) => {
    let responseMessage = '';

    // NB the trpc api is generated code so we don't have a type-safe trpc client here
    (client.invoke as any).subscribe(
      {
        message: 'what is 3 + 5?',
      },
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

      // Lambda functions
      await invokeLambda(findOutput('PyFunctionArn'), 'Python Function');
      await invokeLambda(findOutput('TsFunctionArn'), 'TypeScript Function');

      // Website
      await pingWebsite(findOutput('WebsiteDistributionDomainName'));
    } finally {
      await runCLI(
        `destroy infra ${cdkStageName}/* --output-style=stream --force`,
        opts,
      );
    }
  });
});
