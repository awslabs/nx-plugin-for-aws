/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// Stock @ag-ui/client HttpAgent test against the deployed /agui route.
// No custom AG-UI client code — only URL + a signing `fetch` for IAM auth.
// Usage: AGUI_URL=https://.../prod/agui node test-http-agent.mjs
import { HttpAgent, EventType } from '@ag-ui/client';
import { AwsClient } from 'aws4fetch';
import { execSync } from 'node:child_process';

const envLines = execSync('aws configure export-credentials --format env-no-export')
  .toString()
  .trim()
  .split('\n');
const creds = Object.fromEntries(envLines.map((l) => l.split('=', 2)));

const aws = new AwsClient({
  accessKeyId: creds.AWS_ACCESS_KEY_ID,
  secretAccessKey: creds.AWS_SECRET_ACCESS_KEY,
  sessionToken: creds.AWS_SESSION_TOKEN,
  service: 'execute-api',
  region: 'us-east-1',
});

const AGUI_URL = process.env.AGUI_URL;
if (!AGUI_URL) throw new Error('Set AGUI_URL to the deployed /agui endpoint');

const agent = new HttpAgent({
  url: AGUI_URL,
  threadId: 'thread_stock_httpagent_0001',
  fetch: (url, init) => aws.fetch(url, init),
});

agent.addMessage({
  id: 'msg_1',
  role: 'user',
  content: 'Say the word PONG and nothing else.',
});

let sawRunStarted = false;
let sawRunFinished = false;
let textDeltas = '';

agent.subscribe({
  onEvent: ({ event }) => {
    if (event.type === EventType.RUN_STARTED) sawRunStarted = true;
    if (event.type === EventType.RUN_FINISHED) sawRunFinished = true;
    if (event.type === EventType.TEXT_MESSAGE_CONTENT) textDeltas += event.delta;
    console.log(JSON.stringify(event));
  },
});

const result = await agent.runAgent();
console.log('--- runAgent() result ---');
console.log(JSON.stringify(result, null, 2));
console.log('--- agent.messages after run ---');
console.log(JSON.stringify(agent.messages, null, 2));
console.log('--- summary ---');
console.log({ sawRunStarted, sawRunFinished, textDeltas });
