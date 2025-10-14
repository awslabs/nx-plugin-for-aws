import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAddTool } from './tools/add.js';
import { registerSampleGuidanceResource } from './resources/sample-guidance.js';

/**
 * Create the MCP Server
 */
export const createServer = () => {
  const server = new McpServer({
    name: 'inventory-mcp-server',
    version: '1.0.0',
  });

  registerAddTool(server);
  registerSampleGuidanceResource(server);

  return server;
};
