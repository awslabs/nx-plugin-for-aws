/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, it } from 'vitest';

describe('smoke test - mcp-server', () => {
  it('should start the MCP server and respond to tool calls', async () => {
    // Start the MCP server using the exact command from the docs:
    //   npx -y @aws/nx-plugin-mcp
    // In e2e, the package is published to a local verdaccio registry
    // so we pass --registry to ensure npx fetches from it.
    const registry = process.env.npm_config_registry;
    const version = process.env.NX_E2E_PRESET_VERSION ?? 'latest';
    const transport = new StdioClientTransport({
      command: 'npx',
      args: [
        '-y',
        ...(registry ? [`--registry=${registry}`] : []),
        `@aws/nx-plugin-mcp@${version}`,
      ],
      env: {
        ...process.env,
      },
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
      expect(toolNames).toContain('add-to-existing-project');

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
      expect(createResult.isError).toBeFalsy();

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

      // Test add-to-existing-project — its guide content is pulled from the
      // `get_started/existing-project` docs page bundled into the package,
      // proving the widened docs bundle is reachable at runtime.
      const existingResult = await client.callTool({
        name: 'add-to-existing-project',
        arguments: {
          packageManager: 'pnpm',
          errorMessage:
            'IaC provider "inherit" requires iac.provider to be set',
        },
      });
      const existingText = (existingResult.content[0] as { text: string }).text;
      expect(existingText).toContain('init');
      // Content sourced from the bundled docs guide (not just the static map)
      expect(existingText).toContain('existing');
    } finally {
      await client.close();
    }
  });
});
