/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server';

export const startMcpServer = async () => {
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
  console.error('Nx Plugin for AWS MCP Server listening on STDIO');
};
