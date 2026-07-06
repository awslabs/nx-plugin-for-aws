/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { addToExistingProjectTool } from './add-to-existing-project';

describe('add-to-existing-project tool', () => {
  let client: Client;

  beforeEach(async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    addToExistingProjectTool(server, []);
    client = new Client({ name: 'test-client', version: '1.0.0' });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  const callText = async (args: Record<string, unknown> = {}) => {
    const result = await client.callTool({
      name: 'add-to-existing-project',
      arguments: args,
    });
    return (result.content as { type: string; text: string }[])
      .map((c) => c.text)
      .join('\n');
  };

  it('should reference the init generator', async () => {
    const text = await callText();
    expect(text).toContain('init');
  });

  it('should recommend nx add', async () => {
    const text = await callText();
    expect(text).toContain('nx add @aws/nx-plugin');
  });

  it('should include the common errors reference', async () => {
    const text = await callText();
    expect(text).toContain('Common errors and fixes');
  });

  it('should surface the matching fix first when an error message is supplied', async () => {
    const text = await callText({
      errorMessage:
        'IaC provider "inherit" requires iac.provider to be set in aws-nx-plugin.config.mts',
    });
    expect(text).toContain('Matching the error you reported');
    expect(text).toContain('iac.provider');
  });

  it('should map an out-of-sync error to its fix', async () => {
    const text = await callText({
      errorMessage: 'The workspace is out of sync',
    });
    expect(text).toContain('Matching the error you reported');
    expect(text).toContain('nx sync');
  });
});
