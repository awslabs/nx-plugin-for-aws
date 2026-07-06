/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import PackageJson from '../../package.json' with { type: 'json' };
import { listGenerators } from '../utils/nx';
import { addToExistingProjectTool } from './tools/add-to-existing-project';
import { addCreateWorkspaceCommandTool } from './tools/create-workspace-command';
import {
  addGeneralGuidanceTool,
  TOOL_SELECTION_GUIDE,
} from './tools/general-guidance';
import { addGeneratorGuideTool } from './tools/generator-guide';
import { addListGeneratorsTool } from './tools/list-generators';

/**
 * Create the MCP Server
 */
export const createServer = () => {
  const generators = listGenerators();

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
  addToExistingProjectTool(server, generators);

  return server;
};
