/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createServer } from './server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

describe('MCP Server', () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    // Create a new client instance
    client = new Client({
      name: 'test-client',
      version: '1.0.0',
    });

    // Create the server
    server = createServer();

    // Create linked transports for client and server
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    // Connect both client and server
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        text: () => Promise.resolve('Mocked guide content'),
      }),
    );
  });

  it('should initialize with the correct server information', async () => {
    // Get server info from client
    const instructions = client.getInstructions();
    expect(instructions).toContain('Tool Selection Guide');
  });

  it('should list available tools', async () => {
    // List tools using client
    const tools = await client.listTools();

    // Verify tools are registered
    const toolNames = tools.tools.map((tool) => tool.name);
    expect(toolNames).toContain('general-guidance');
    expect(toolNames).toContain('create-workspace-command');
    expect(toolNames).toContain('list-generators');
    expect(toolNames).toContain('generator-guide');
  });

  it('should execute create-workspace-command tool', async () => {
    // Call the tool using client
    const result = await client.callTool({
      name: 'create-workspace-command',
      arguments: {
        workspaceName: 'test-workspace',
        packageManager: 'pnpm',
      },
    });

    // Verify result
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('npx create-nx-workspace@');
    expect(result.content[0].text).toContain('--preset=@aws/nx-plugin');
  });

  it('should execute list-generators tool', async () => {
    // Call the tool using client
    const result = await client.callTool({
      name: 'list-generators',
      arguments: {
        packageManager: 'pnpm',
      },
    });

    // Verify result
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Available Generators');
    expect(result.content[0].text).toContain('ts#project');
  });

  it('should execute general-guidance tool', async () => {
    // Call the tool using client
    const result = await client.callTool({
      name: 'general-guidance',
      arguments: {},
    });

    // Verify result
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Nx Plugin for AWS Guidance');
    expect(result.content[0].text).toContain('Getting Started');
    expect(result.content[0].text).toContain('Nx Primer');
    expect(result.content[0].text).toContain('General Instructions');
  });

  it('should execute generator-guide tool with valid generator', async () => {
    // Call the tool using client
    const result = await client.callTool({
      name: 'generator-guide',
      arguments: {
        packageManager: 'pnpm',
        generator: 'ts#project',
      },
    });

    // Verify result
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Guide');
    expect(result.content[0].text).toContain('Mocked guide content');

    expect(global.fetch).toHaveBeenCalledWith(
      `https://raw.githubusercontent.com/awslabs/nx-plugin-for-aws/refs/heads/main/docs/src/content/docs/en/guides/typescript-project.mdx`,
    );
  });

  it('should post process guide pages fetched by the generator-guide tool', async () => {
    global.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        text: () => Promise.resolve('<NxCommands commands={["foo"]} />'),
      }),
    );

    // Call the tool using client
    const result = await client.callTool({
      name: 'generator-guide',
      arguments: {
        packageManager: 'pnpm',
        generator: 'ts#project',
      },
    });

    // Verify result
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('pnpm nx foo');
  });

  it('should throw an error when generator-guide is called with an invalid generator', async () => {
    // Call the tool with an invalid generator ID
    await expect(
      client.callTool({
        name: 'generator-guide',
        arguments: {
          packageManager: 'pnpm',
          generator: 'invalid-generator-id-that-does-not-exist',
        },
      }),
    ).rejects.toThrow();
  });
});
