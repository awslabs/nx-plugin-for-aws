/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PackageManagerSchema } from '../schema';

/**
 * Add a tool which tells a model how to create an Nx workspace
 */
export const addCreateWorkspaceCommandTool = (server: McpServer) => {
  server.tool(
    'create-workspace-command',
    { workspaceName: z.string(), packageManager: PackageManagerSchema },
    ({ workspaceName, packageManager }) => ({
      content: [
        {
          type: 'text',
          text: `Run the following command to create a workspace:

\`\`\`bash
npx create-nx-workspace@~21.0.3 ${workspaceName} --pm=${packageManager} --preset=@aws/nx-plugin --ci=skip
\`\`\`

Note that this will create a workspace in a new directory named ${workspaceName}. If you are already working in the directory
you would like for your workspace, you can move all the files up one level and delete the empty directory afterwards, eg:

\`\`\`bash
mv ${workspaceName}/{*,.*} ./ && rm -rf ${workspaceName}
\`\`\`

(Note that the above command will complain about moving . and .. but that is expected and ok!)
  `,
        },
      ],
    }),
  );
};
