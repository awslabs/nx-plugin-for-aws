/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTree } from '@nx/devkit/testing';
import { readJson, writeJson, Tree } from '@nx/devkit';
import TOML from '@iarna/toml';
import { describe, it, expect } from 'vitest';
import { configureMcpServers, NX_PLUGIN_MCP_SERVER_NAME } from './mcp';

describe('mcp utils', () => {
  describe('configureMcpServers', () => {
    it('should configure the MCP server across all agent config locations', () => {
      const tree = createTree();

      configureMcpServers(tree);

      // Agents using the `mcpServers` config shape
      for (const filePath of [
        '.mcp.json',
        '.cursor/mcp.json',
        '.kiro/settings/mcp.json',
        '.gemini/settings.json',
      ]) {
        const config = readJson(tree, filePath);
        expect(config.mcpServers[NX_PLUGIN_MCP_SERVER_NAME]).toEqual({
          command: 'npx',
          args: ['-y', '@aws/nx-plugin-mcp'],
        });
      }

      // GitHub Copilot uses the `servers` key with an explicit type
      const vscode = readJson(tree, '.vscode/mcp.json');
      expect(vscode.servers[NX_PLUGIN_MCP_SERVER_NAME]).toEqual({
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@aws/nx-plugin-mcp'],
      });

      // OpenAI Codex CLI uses TOML
      const codex = TOML.parse(tree.read('.codex/config.toml', 'utf-8'));
      expect((codex.mcp_servers as any)[NX_PLUGIN_MCP_SERVER_NAME]).toEqual({
        command: 'npx',
        args: ['-y', '@aws/nx-plugin-mcp'],
      });
    });

    it('should preserve existing servers in JSON configs', () => {
      const tree = createTree();
      writeJson(tree, '.mcp.json', {
        mcpServers: {
          'existing-server': { command: 'node', args: ['server.js'] },
        },
      });

      configureMcpServers(tree);

      const config = readJson(tree, '.mcp.json');
      expect(config.mcpServers['existing-server']).toEqual({
        command: 'node',
        args: ['server.js'],
      });
      expect(config.mcpServers[NX_PLUGIN_MCP_SERVER_NAME]).toBeDefined();
    });

    it('should preserve existing servers in the Copilot config', () => {
      const tree = createTree();
      writeJson(tree, '.vscode/mcp.json', {
        servers: {
          'existing-server': { type: 'stdio', command: 'node', args: [] },
        },
      });

      configureMcpServers(tree);

      const config = readJson(tree, '.vscode/mcp.json');
      expect(config.servers['existing-server']).toBeDefined();
      expect(config.servers[NX_PLUGIN_MCP_SERVER_NAME]).toBeDefined();
    });

    it('should preserve existing servers in the Codex TOML config', () => {
      const tree = createTree();
      tree.write(
        '.codex/config.toml',
        TOML.stringify({
          mcp_servers: {
            'existing-server': { command: 'node', args: ['server.js'] },
          },
        }),
      );

      configureMcpServers(tree);

      const config = TOML.parse(tree.read('.codex/config.toml', 'utf-8'));
      expect((config.mcp_servers as any)['existing-server']).toBeDefined();
      expect(
        (config.mcp_servers as any)[NX_PLUGIN_MCP_SERVER_NAME],
      ).toBeDefined();
    });

    it('should be idempotent', () => {
      const tree: Tree = createTree();

      configureMcpServers(tree);
      const first = tree.read('.mcp.json', 'utf-8');
      configureMcpServers(tree);
      const second = tree.read('.mcp.json', 'utf-8');

      expect(first).toEqual(second);
    });
  });
});
