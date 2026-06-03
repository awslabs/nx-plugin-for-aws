/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, readJson, writeJson } from '@nx/devkit';
import { updateToml } from './toml';

/**
 * Name of the Nx Plugin for AWS MCP server, used as the key in each agent's config.
 */
export const NX_PLUGIN_MCP_SERVER_NAME = 'nx-plugin-for-aws';

/**
 * Command used to launch the Nx Plugin for AWS MCP server.
 */
export const NX_PLUGIN_MCP_SERVER_COMMAND = 'npx';

/**
 * Arguments used to launch the Nx Plugin for AWS MCP server.
 */
export const NX_PLUGIN_MCP_SERVER_ARGS = ['-y', '@aws/nx-plugin-mcp'];

/**
 * A single stdio MCP server entry, shared by agents that use the `mcpServers` config shape.
 */
const stdioServerEntry = () => ({
  command: NX_PLUGIN_MCP_SERVER_COMMAND,
  args: NX_PLUGIN_MCP_SERVER_ARGS,
});

/**
 * Merge the Nx Plugin for AWS MCP server into a JSON config file under the given key,
 * preserving any other servers already configured. Creates the file if it does not exist.
 */
const mergeJsonMcpConfig = (
  tree: Tree,
  filePath: string,
  key: 'mcpServers' | 'servers',
  entry: Record<string, unknown>,
) => {
  const config = tree.exists(filePath) ? readJson(tree, filePath) : {};
  config[key] = {
    ...config[key],
    [NX_PLUGIN_MCP_SERVER_NAME]: entry,
  };
  writeJson(tree, filePath, config);
};

/**
 * Configure the Nx Plugin for AWS MCP server across the project-level config locations
 * used by common coding agents, so agents working in the workspace can use it to scaffold
 * AWS projects with the Nx Plugin for AWS.
 *
 * Existing servers and unrelated config in each file are preserved.
 */
export const configureMcpServers = (tree: Tree) => {
  // Agents using the `mcpServers` config shape (Claude Code, Cursor, Kiro, Gemini CLI)
  const mcpServersFiles = [
    '.mcp.json', // Claude Code
    '.cursor/mcp.json', // Cursor
    '.kiro/settings/mcp.json', // Kiro
    '.gemini/settings.json', // Gemini CLI
  ];
  for (const filePath of mcpServersFiles) {
    mergeJsonMcpConfig(tree, filePath, 'mcpServers', stdioServerEntry());
  }

  // GitHub Copilot uses the `servers` key with an explicit `type`
  mergeJsonMcpConfig(tree, '.vscode/mcp.json', 'servers', {
    type: 'stdio',
    ...stdioServerEntry(),
  });

  // OpenAI Codex CLI uses TOML under the `mcp_servers` table
  const codexConfig = '.codex/config.toml';
  if (!tree.exists(codexConfig)) {
    tree.write(codexConfig, '');
  }
  updateToml(tree, codexConfig, (prev) => ({
    ...prev,
    mcp_servers: {
      ...(prev.mcp_servers as object),
      [NX_PLUGIN_MCP_SERVER_NAME]: {
        command: NX_PLUGIN_MCP_SERVER_COMMAND,
        args: NX_PLUGIN_MCP_SERVER_ARGS,
      },
    },
  }));
};
