/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod-v3';
import { PackageManagerSchema } from '../schema';

/**
 * Add a tool which tells a model how to create an Nx workspace
 */
export const addCreateWorkspaceCommandTool = (server: McpServer) => {
  server.tool(
    'create-workspace-command',
    'Tool to discover how to create a workspace to start a new project.',
    { workspaceName: z.string(), packageManager: PackageManagerSchema },
    ({ workspaceName, packageManager }) => ({
      content: [
        {
          type: 'text',
          text: `Run the following command to create a workspace:

\`\`\`bash
npx create-nx-workspace@~21.0.3 ${workspaceName} --pm=${packageManager} --preset=@aws/nx-plugin --ci=skip
\`\`\`

This will create a new workspace within the ${workspaceName} directory.
  `,
        },
      ],
    }),
  );
};
