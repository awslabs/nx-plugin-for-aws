/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
// Bring-your-own AG-UI client: knows only the /agui URL. No @ag-ui/client,
// no @ag-ui/core, no generated SDK/types from this repo — just fetch + raw
// SSE parsing, to prove the wire contract is a plain AG-UI SSE stream.
// Usage: AGUI_URL=https://.../prod/agui node bring-your-own.mjs
import { AwsClient } from 'aws4fetch';
import { execSync } from 'node:child_process';

const envLines = execSync('aws configure export-credentials --format env-no-export')
  .toString()
  .trim()
  .split('\n');
const creds = Object.fromEntries(envLines.map((l) => l.split('=', 2)));

// IAM SigV4 signing is the only AWS-specific part — orthogonal to the AG-UI
// wire contract itself, needed only because this route is IAM-authenticated.
const aws = new AwsClient({
  accessKeyId: creds.AWS_ACCESS_KEY_ID,
  secretAccessKey: creds.AWS_SECRET_ACCESS_KEY,
  sessionToken: creds.AWS_SESSION_TOKEN,
  service: 'execute-api',
  region: 'us-east-1',
});

const body = JSON.stringify({
  threadId: 'thread_byo_0001',
  runId: 'run_byo_0001',
  messages: [
    { id: 'm1', role: 'user', content: 'Say the word PONG and nothing else.' },
  ],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
});

const AGUI_URL = process.env.AGUI_URL;
if (!AGUI_URL) throw new Error('Set AGUI_URL to the deployed /agui endpoint');

const res = await aws.fetch(AGUI_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body,
});

console.log('status', res.status);
console.log('content-type', res.headers.get('content-type'));

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = '';
const events = [];
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let idx;
  // Plain SSE framing: "data: <json>\n\n" — parsed with no library at all.
  while ((idx = buffer.indexOf('\n\n')) !== -1) {
    const chunk = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 2);
    const line = chunk.split('\n').find((l) => l.startsWith('data: '));
    if (line) {
      const evt = JSON.parse(line.slice('data: '.length));
      events.push(evt);
      console.log('event:', JSON.stringify(evt));
    }
  }
}

const text = events
  .filter((e) => e.type === 'TEXT_MESSAGE_CONTENT')
  .map((e) => e.delta)
  .join('');
console.log('--- reconstructed assistant text ---', JSON.stringify(text));
console.log('--- event type sequence ---', events.map((e) => e.type));
