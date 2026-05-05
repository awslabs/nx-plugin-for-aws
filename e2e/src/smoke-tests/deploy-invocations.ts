/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { AwsClient } from 'aws4fetch';
import { Lambda } from '@aws-sdk/client-lambda';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// @ts-expect-error no types for virtual module
import { AgentCoreTrpcClient } from 'virtual:ts-template/ts/strands-agent/files/http/agent-core-trpc-client';

/**
 * Shared assertion helpers that the `cdk-deploy` and `terraform-deploy`
 * smoke tests use to exercise deployed resources. Both specs pull the
 * stack outputs from their respective IaC tool, then call these helpers
 * with the raw endpoint URLs / ARNs. Keeping the invocation logic in one
 * place means the two tests stay in lock-step as the generators evolve.
 */

const AGENT_CORE_SESSION_ID = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const getRegion = (): string => process.env.AWS_REGION || 'us-west-2';

export async function createAwsClient(
  service = 'execute-api',
): Promise<AwsClient> {
  const credentials = await fromNodeProviderChain()();
  return new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    sessionToken: credentials.sessionToken,
    service,
    region: getRegion(),
  });
}

function buildAgentCoreUrl(arn: string): string {
  const encodedArn = arn.replace(/:/g, '%3A').replace(/\//g, '%2F');
  return `https://bedrock-agentcore.${getRegion()}.amazonaws.com/runtimes/${encodedArn}/invocations?qualifier=DEFAULT`;
}

/**
 * Stage invoke URLs come back in two shapes:
 * - REST  → `https://{id}.execute-api.{region}.amazonaws.com/prod`  (no trailing slash)
 * - HTTP  → `https://{id}.execute-api.{region}.amazonaws.com/`      (trailing slash for `$default` stage)
 *
 * Naively appending `/echo` produces `.../prod/echo` (good) or
 * `.../%2F/echo` (bad — AWS SigV4 signs the canonical path which would
 * then mismatch). Strip any trailing slash so both shapes concatenate cleanly.
 */
const normalizeApiUrl = (url: string): string => url.replace(/\/$/, '');

export async function invokeTrpcApi(
  apiUrl: string,
  apiName: string,
): Promise<void> {
  const aws = await createAwsClient();
  console.log(`Testing ${apiName} at ${apiUrl}`);
  const input = encodeURIComponent(JSON.stringify({ message: 'test' }));
  const response = await aws.fetch(
    `${normalizeApiUrl(apiUrl)}/echo?input=${input}`,
  );
  const data = await response.json();
  console.log(`${apiName} response:`, data);
  expect(data.result.data.result).toBe('test');
}

export async function invokeRestApi(
  apiUrl: string,
  apiName: string,
): Promise<void> {
  const aws = await createAwsClient();
  console.log(`Testing ${apiName} at ${apiUrl}`);
  const response = await aws.fetch(
    `${normalizeApiUrl(apiUrl)}/echo?message=test`,
  );
  const data = await response.json();
  console.log(`${apiName} response:`, data);
  expect(data.message).toBe('test');
}

export async function invokeAgentCoreMcp(
  arn: string,
  mcpName: string,
): Promise<void> {
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

export async function invokeAgentCoreAgent(
  arn: string,
  agentName: string,
  message = 'what is 3 + 5 - 2?',
): Promise<string> {
  const aws = await createAwsClient('bedrock-agentcore');
  console.log(`Testing ${agentName} with ARN ${arn}`);

  // Retry on 424/429/5xx — these typically come from AgentCore cold starts
  // where the runtime is still pulling the container image on first invoke.
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await aws.fetch(buildAgentCoreUrl(arn), {
      method: 'POST',
      body: JSON.stringify({ message }),
      headers: {
        'Content-Type': 'application/json',
        'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': AGENT_CORE_SESSION_ID,
      },
    });

    if (response.status !== 200 && attempt < maxAttempts) {
      const body = await response.text().catch(() => '');
      console.log(
        `${agentName} attempt ${attempt}/${maxAttempts} returned ${response.status}; retrying in 15s. Body: ${body.slice(0, 500)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      continue;
    }

    const chunks: { content: string }[] = [];
    let buffer = '';
    const reader = response.body
      .pipeThrough(new TextDecoderStream())
      .getReader();
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
  // Unreachable — the final attempt's expect() throws if it still fails.
  throw new Error(`Exhausted retries invoking ${agentName}`);
}

export async function invokeTrpcAgentCoreAgent(
  arn: string,
  agentName: string,
  message = 'what is 3 * 5 / 4?',
): Promise<string> {
  console.log(`Testing ${agentName} with ARN ${arn}`);

  // Dogfood our vended client
  const client = AgentCoreTrpcClient.withIamAuth({ agentRuntimeArn: arn });

  const response = await new Promise<string>((resolve, reject) => {
    let responseMessage = '';

    // NB the trpc api is generated code so we don't have a type-safe trpc client here
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client.invoke as any).subscribe(
      { message },
      {
        onData: (chunk: string) => {
          console.log(chunk);
          responseMessage += chunk;
        },
        onComplete: () => resolve(responseMessage),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onError: (error: any) => reject(error),
      },
    );
  });
  console.log('Agent Response', response);
  expect(response).not.toHaveLength(0);
  return response;
}

export async function invokeAgentCoreA2a(
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

  const region = getRegion();
  const encodedArn = encodeURIComponent(arn);
  // AgentCore mounts A2A at the `/invocations/` root (trailing slash matters).
  const baseUrl = `https://bedrock-agentcore.${region}.amazonaws.com/runtimes/${encodedArn}/invocations/`;

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
      headers.set(
        'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id',
        AGENT_CORE_SESSION_ID,
      );
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

export async function invokeLambda(
  arn: string,
  lambdaName: string,
): Promise<void> {
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
  // Lambda returns StatusCode 200 even when the handler throws — the handler
  // failure surfaces via FunctionError. Assert both to catch runtime errors
  // like missing-module ImportErrors that only manifest in a deployed Lambda.
  expect(res.StatusCode).toBe(200);
  expect(res.FunctionError).toBeUndefined();
  console.log(`Successfully invoked ${lambdaName}`);
}

export async function pingWebsite(domain: string): Promise<void> {
  console.log('Testing website with domain', domain);
  const status = (await fetch(`https://${domain}/`)).status;
  console.log('Website response status:', status);
  expect(status).toBe(200);
  expect(
    await (await fetch(`https://${domain}/runtime-config.json`)).json(),
  ).toHaveProperty('cognitoProps');
  console.log('Successfully pinged website');
}
