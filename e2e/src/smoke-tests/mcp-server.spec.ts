/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

describe('smoke test - mcp-server', () => {
  it('should start the MCP server and respond to tool calls', async () => {
    // Start the MCP server using the exact command from the docs
    const transport = new StdioClientTransport({
      command: 'npx',
      args: ['-y', '@aws/nx-plugin-mcp'],
    });

    const client = new Client({
      name: 'e2e-test-client',
      version: '1.0.0',
    });

    await client.connect(transport);

    try {
      // Verify the server exposes the expected tools
      const { tools } = await client.listTools();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain('general-guidance');
      expect(toolNames).toContain('create-workspace-command');
      expect(toolNames).toContain('list-generators');
      expect(toolNames).toContain('generator-guide');

      // Every tool must have a description (required by Amazon Q CLI)
      for (const tool of tools) {
        expect(tool.description).toBeDefined();
      }

      // Test create-workspace-command
      const createResult = await client.callTool({
        name: 'create-workspace-command',
        arguments: { workspaceName: 'my-app', packageManager: 'pnpm' },
      });
      expect(createResult.content).toHaveLength(1);
      expect((createResult.content[0] as { text: string }).text).toContain(
        'create-nx-workspace',
      );
      expect((createResult.content[0] as { text: string }).text).toContain(
        '--preset=@aws/nx-plugin',
      );

      // Test list-generators
      const listResult = await client.callTool({
        name: 'list-generators',
        arguments: { packageManager: 'pnpm' },
      });
      expect((listResult.content[0] as { text: string }).text).toContain(
        'ts#project',
      );

      // Test generator-guide
      const guideResult = await client.callTool({
        name: 'generator-guide',
        arguments: { packageManager: 'pnpm', generator: 'ts#project' },
      });
      expect((guideResult.content[0] as { text: string }).text).toContain(
        'ts#project',
      );

      // Test general-guidance
      const guidanceResult = await client.callTool({
        name: 'general-guidance',
        arguments: {},
      });
      expect((guidanceResult.content[0] as { text: string }).text).toContain(
        'Nx Plugin for AWS',
      );
    } finally {
      await client.close();
    }
  });
});
