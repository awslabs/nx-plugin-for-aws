/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildGeneratorInfoList } from '../../nx-plugin/src/utils/generators';
import { addCreateWorkspaceCommandTool } from '../../nx-plugin/src/mcp-server/tools/create-workspace-command';
import { addListGeneratorsTool } from '../../nx-plugin/src/mcp-server/tools/list-generators';
import { addGeneratorGuideTool } from '../../nx-plugin/src/mcp-server/tools/generator-guide';
import {
  addGeneralGuidanceTool,
  TOOL_SELECTION_GUIDE,
} from '../../nx-plugin/src/mcp-server/tools/general-guidance';
import PackageJson from '../../nx-plugin/package.json';
import * as path from 'path';

/**
 * Build the generator list using a base directory resolved relative to this
 * bundled entry point. The compiled bundle lives at `bin/aws-nx-mcp.cjs`,
 * so one level up is the package root where `generators.json` and the
 * `src/` schema files are located.
 */
const generators = buildGeneratorInfoList(path.resolve(__dirname, '..')).filter(
  (g) => !g.hidden,
);

const createServer = () => {
  const server = new McpServer(
    {
      name: 'nx-plugin-for-aws',
      version: PackageJson.version,
    },
    {
      instructions: `# Nx Plugin for AWS MCP Server

This server provides resources and tools for quickly scaffolding AWS projects within an Nx workspace (monorepo), using the Nx Plugin for AWS (@aws/nx-plugin).

The Nx Plugin for AWS provides "generators" to add projects or functionality to your workspace. Use this to build the foundations of any project you are building
on AWS, if the generators apply to your use case.

${TOOL_SELECTION_GUIDE}
`,
    },
  );

  addGeneralGuidanceTool(server, generators);
  addCreateWorkspaceCommandTool(server);
  addListGeneratorsTool(server, generators);
  addGeneratorGuideTool(server, generators);

  return server;
};

void (async () => {
  try {
    const transport = new StdioServerTransport();
    await createServer().connect(transport);
    console.error('Nx Plugin for AWS MCP Server listening on STDIO');
  } catch (e) {
    console.error(e);
  }
})();
