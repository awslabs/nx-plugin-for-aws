/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type { Writable } from 'node:stream';
import {
  BedrockAgentCoreClient,
  InvokeHarnessCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { EventEncoder } from '@ag-ui/encoder';
import type { RunAgentInput } from '@ag-ui/core';
import {
  mapHarnessStreamToAgui,
  toHarnessMessages,
} from './converse-to-agui.js';

const HARNESS_ARN = process.env.HARNESS_ARN!;
const client = new BedrockAgentCoreClient({});

function getAllowedOrigin(event: APIGatewayProxyEvent): string {
  const origin = event.headers?.origin ?? event.headers?.Origin;
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') ?? [];
  return allowedOrigins.length > 0 && origin && allowedOrigins.includes(origin)
    ? origin
    : (allowedOrigins[0] ?? '*');
}

// AgentCore Runtime Session IDs must be >= 33 characters.
function sessionIdFor(actorId: string, threadId: string): string {
  return `${actorId}_${threadId}`.slice(0, 100).padEnd(33, '0');
}

// IAM inbound has no JWT `sub`; the caller's IAM principal ARN is the closest
// server-derived identity available, and is never taken from the request body.
// Sanitized because runtimeSessionId (which embeds this) only allows
// [a-zA-Z0-9-_], but ARNs contain ':' and '/'.
function actorIdFromEvent(event: APIGatewayProxyEvent): string {
  const arn = event.requestContext.identity?.userArn ?? 'anonymous';
  return arn.replace(/[^a-zA-Z0-9_-]/g, '-');
}

export const handler = awslambda.streamifyResponse(
  async (event: APIGatewayProxyEvent, responseStream: Writable) => {
    const encoder = new EventEncoder();
    const httpResponseStream = awslambda.HttpResponseStream.from(
      responseStream,
      {
        statusCode: 200,
        headers: {
          'Content-Type': encoder.getContentType(),
          'Access-Control-Allow-Origin': getAllowedOrigin(event),
          'Cache-Control': 'no-cache',
        },
      },
    );

    try {
      const input = JSON.parse(event.body ?? '{}') as RunAgentInput;
      const actorId = actorIdFromEvent(event);
      const runtimeSessionId = sessionIdFor(actorId, input.threadId);

      // Only `messages` + `threadId` are read from the client input. Every
      // other Harness-invocation field (systemPrompt, model, tools,
      // allowedTools, skills, actorId) is pinned server-side.
      const { stream } = await client.send(
        new InvokeHarnessCommand({
          harnessArn: HARNESS_ARN,
          runtimeSessionId,
          actorId,
          messages: toHarnessMessages(input.messages),
        }),
      );

      for await (const aguiEvent of mapHarnessStreamToAgui(stream!, {
        threadId: input.threadId,
        runId: input.runId,
      })) {
        httpResponseStream.write(encoder.encodeSSE(aguiEvent));
      }
    } catch (err) {
      console.error('agui handler error', err);
    } finally {
      httpResponseStream.end();
    }
  },
);
