/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { Agent } from 'https';

const MODEL_ID = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

/**
 * Generate an AI-summarised headline for a release and send the Slack notification.
 *
 * Required env vars:
 *   SLACK_WEBHOOK_URL  — Slack webhook trigger URL
 *   RELEASE_NAME       — Release name (e.g. "v0.50.0")
 *   RELEASE_VERSION    — Tag name (e.g. "v0.50.0")
 *   RELEASE_BODY       — Release changelog body (markdown)
 *   RELEASE_URL        — URL to the GitHub release
 */
async function main() {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const name = process.env.RELEASE_NAME;
  const version = process.env.RELEASE_VERSION;
  const releaseBody = process.env.RELEASE_BODY;
  const url = process.env.RELEASE_URL;

  if (!webhookUrl || !name || !version || !releaseBody || !url) {
    console.error(
      'Missing required environment variables: SLACK_WEBHOOK_URL, RELEASE_NAME, RELEASE_VERSION, RELEASE_BODY, RELEASE_URL',
    );
    process.exit(1);
  }

  const headline = await generateHeadline(version, releaseBody);
  console.log(`Generated headline: ${headline}`);

  await sendSlackNotification(webhookUrl, {
    name,
    version,
    body: releaseBody,
    url,
    headline,
  });

  console.log('Slack notification sent successfully');
}

async function generateHeadline(
  version: string,
  releaseBody: string,
): Promise<string> {
  const client = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || 'us-west-2',
    credentials: fromNodeProviderChain(),
    requestHandler: new NodeHttpHandler({
      httpsAgent: new Agent({ maxSockets: 500 }),
    }),
  });

  const systemPrompt = `You are a release notes headline writer for an open-source Nx plugin for AWS (@aws/nx-plugin).
Given a version number and a changelog body (in markdown), produce a single short headline (max 100 characters) that summarises the most important features and fixes in this release.

Rules:
1. Be concise — the headline should read like a news title.
2. Focus on what matters most to developers using the plugin.
3. Do NOT include the version number in the headline — it is shown separately.
4. Do NOT use quotes around the headline.
5. Output ONLY the headline text, nothing else.`;

  const userMessage = `Version: ${version}

Changelog:
${releaseBody}`;

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 256,
      temperature: 0.5,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    }),
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody.content[0].text.trim();
}

async function sendSlackNotification(
  webhookUrl: string,
  payload: {
    name: string;
    version: string;
    body: string;
    url: string;
    headline: string;
  },
): Promise<void> {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Slack webhook returned ${response.status}: ${body}`);
  }
}

main().catch((error) => {
  console.error(
    `Failed to send release notification: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
