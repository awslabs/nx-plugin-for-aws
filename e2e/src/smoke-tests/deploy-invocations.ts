/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// @ts-expect-error no types for virtual module
import { AgentCoreTrpcClient } from 'virtual:ts-template/ts/agent/files/http/agent-core-trpc-client';
import { Lambda } from '@aws-sdk/client-lambda';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AwsClient } from 'aws4fetch';

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
  expect(data.result.data.message).toBe('test');
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

/**
 * List tools on a deployed AgentCore Gateway over SigV4 and call one,
 * asserting the result contains the expected text. Used to exercise
 * chained gateways (gateway -> gateway -> MCP server) directly, without
 * an agent in front.
 */
export async function invokeAgentCoreGatewayTool(
  gatewayUrl: string,
  gatewayName: string,
  toolName: string,
  args: Record<string, unknown>,
  expected: string,
): Promise<void> {
  const aws = await createAwsClient('bedrock-agentcore');
  console.log(`Testing ${gatewayName} at ${gatewayUrl}`);

  const transport = new StreamableHTTPClientTransport(new URL(gatewayUrl), {
    fetch: aws.fetch.bind(aws),
  });

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    console.log(`${gatewayName} tools:`, names);
    expect(names).toContain(toolName);

    const result = await client.callTool({ name: toolName, arguments: args });
    const resultText = JSON.stringify(result.content);
    console.log(`${gatewayName} ${toolName} result:`, resultText);
    expect(resultText).toContain(expected);
  } finally {
    await client.close();
  }
}

export async function invokeAgentCoreAgent(
  arn: string,
  agentName: string,
  prompt = 'what is 3 + 5 - 2?',
): Promise<string> {
  const aws = await createAwsClient('bedrock-agentcore');
  console.log(`Testing ${agentName} with ARN ${arn}`);

  // Retry on 424/429/5xx — these typically come from AgentCore cold starts
  // where the runtime is still pulling the container image on first invoke.
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await aws.fetch(buildAgentCoreUrl(arn), {
      method: 'POST',
      body: JSON.stringify({ prompt }),
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

/**
 * Invoke a deployed AG-UI agent (Strands or LangChain). AG-UI agents serve a
 * single `POST /invocations` that takes a `RunAgentInput` body and streams
 * AG-UI events over Server-Sent Events. Assert a 200 + a `data:` SSE stream
 * with no `RUN_ERROR` event (the server surfaces agent failures as a `data:`
 * RUN_ERROR rather than a non-200, so a bare status check would miss them).
 */
export async function invokeAgentCoreAgUi(
  arn: string,
  agentName: string,
  message = 'What is 3 times 5?',
): Promise<string> {
  const aws = await createAwsClient('bedrock-agentcore');
  console.log(`Testing ${agentName} (AG-UI) with ARN ${arn}`);

  // Retry on 424/429/5xx — AgentCore cold starts pull the container image on
  // first invoke and can transiently fail before the runtime is ready.
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await aws.fetch(buildAgentCoreUrl(arn), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': AGENT_CORE_SESSION_ID,
      },
      body: JSON.stringify({
        threadId: 'test-thread',
        runId: 'test-run',
        messages: [{ id: 'msg-1', role: 'user', content: message }],
        state: {},
        tools: [],
        context: [],
        forwardedProps: {},
      }),
    });

    // A RUN_ERROR event arrives in a 200 stream, so check the body as well as
    // the status — transient failures (e.g. a dropped MCP connection mid-run)
    // surface there rather than as a non-200.
    const body = await response.text().catch(() => '');
    if (
      (response.status !== 200 || body.includes('RUN_ERROR')) &&
      attempt < maxAttempts
    ) {
      console.log(
        `${agentName} attempt ${attempt}/${maxAttempts} returned ${response.status}; retrying in 15s. Body: ${body.slice(0, 500)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      continue;
    }
    console.log(
      `${agentName} (AG-UI) response status:`,
      response.status,
      body.slice(0, 200),
    );
    expect(response.status).toBe(200);
    expect(body).toContain('data:');
    expect(body).not.toContain('RUN_ERROR');
    console.log(`Successfully invoked ${agentName} (AG-UI)`);
    return body;
  }
  // Unreachable — the final attempt's expect() throws if it still fails.
  throw new Error(`Exhausted retries invoking ${agentName}`);
}

export async function invokeTrpcAgentCoreAgent(
  arn: string,
  agentName: string,
  prompt = 'what is 3 * 5 / 4?',
): Promise<string> {
  console.log(`Testing ${agentName} with ARN ${arn}`);

  // Dogfood our vended client
  const client = AgentCoreTrpcClient.withIamAuth({ agentRuntimeArn: arn });

  const response = await new Promise<string>((resolve, reject) => {
    let responseMessage = '';

    // NB the trpc api is generated code so we don't have a type-safe trpc client here
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (client.invoke as any).subscribe(
      { prompt },
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

export async function invokeCustomAuthApi(
  apiUrl: string,
  apiName: string,
): Promise<void> {
  console.log(`Testing ${apiName} Custom Auth (deny) at ${apiUrl}`);
  // Requests without valid auth should be denied (401/403)
  const response = await fetch(`${normalizeApiUrl(apiUrl)}/echo?message=test`);
  console.log(`${apiName} response status (no auth):`, response.status);
  expect([401, 403]).toContain(response.status);
}

export async function invokeCustomAuthTrpcApi(
  apiUrl: string,
  apiName: string,
): Promise<void> {
  console.log(`Testing ${apiName} Custom Auth (deny) at ${apiUrl}`);
  const input = encodeURIComponent(JSON.stringify({ message: 'test' }));
  // Requests without valid auth should be denied (401/403)
  const response = await fetch(
    `${normalizeApiUrl(apiUrl)}/echo?input=${input}`,
  );
  console.log(`${apiName} response status (no auth):`, response.status);
  expect([401, 403]).toContain(response.status);
}

/**
 * IAM-authorized (SigV4) API Gateway endpoints must reject an unsigned request.
 * API Gateway returns 403 ("Missing Authentication Token" / "Forbidden") when
 * the SigV4 signature is absent, so a bare fetch should never reach the
 * integration. Covers both the tRPC (`?input=`) and REST/FastAPI/Smithy
 * (`?message=`) shapes — the query string is irrelevant since auth is rejected
 * before routing.
 */
export async function invokeIamApiNoAuthDenied(
  apiUrl: string,
  apiName: string,
): Promise<void> {
  console.log(`Testing ${apiName} IAM deny (no SigV4) at ${apiUrl}`);
  const response = await fetch(`${normalizeApiUrl(apiUrl)}/echo?message=test`);
  console.log(`${apiName} response status (no auth):`, response.status);
  expect([401, 403]).toContain(response.status);
}

/**
 * AgentCore runtimes require SigV4 (`bedrock-agentcore`). An unsigned invoke
 * must be denied before the runtime is reached. Used for MCP servers, agents
 * (HTTP/AG-UI/tRPC) and A2A runtimes alike — all share the same runtime
 * invocation URL and IAM auth, so an unsigned POST should be rejected
 * regardless of the body the runtime expects.
 */
export async function invokeAgentCoreNoAuthDenied(
  arn: string,
  name: string,
): Promise<void> {
  console.log(`Testing ${name} AgentCore deny (no SigV4) with ARN ${arn}`);
  const response = await fetch(buildAgentCoreUrl(arn), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Amzn-Bedrock-AgentCore-Runtime-Session-Id': AGENT_CORE_SESSION_ID,
    },
    body: JSON.stringify({ prompt: 'hello' }),
  });
  console.log(`${name} response status (no auth):`, response.status);
  expect([401, 403]).toContain(response.status);
}

/**
 * AgentCore Gateways require SigV4 too. An unsigned MCP request to the gateway
 * URL must be denied before Cedar authorization or tool routing is reached.
 */
export async function invokeAgentCoreGatewayNoAuthDenied(
  gatewayUrl: string,
  gatewayName: string,
): Promise<void> {
  console.log(
    `Testing ${gatewayName} Gateway deny (no SigV4) at ${gatewayUrl}`,
  );
  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  });
  console.log(`${gatewayName} response status (no auth):`, response.status);
  expect([401, 403]).toContain(response.status);
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
