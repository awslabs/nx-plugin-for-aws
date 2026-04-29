/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PackageManagerSchema } from '../schema';
import { IAC_PROVIDERS } from '../../utils/iac-providers';
import { buildCreateNxWorkspaceCommand } from '../../utils/commands';

/**
 * Add a tool which tells a model how to create an Nx workspace
 */
export const addCreateWorkspaceCommandTool = (server: McpServer) => {
  server.registerTool(
    'create-workspace-command',
    {
      description:
        'Tool to discover how to create a workspace to start a new project.',
      inputSchema: {
        packageManager: PackageManagerSchema,
      },
    },
    ({ packageManager }) => ({
      content: [
        {
          type: 'text' as const,
          text: `Run the following command to create a workspace:

\`\`\`bash
${buildCreateNxWorkspaceCommand(packageManager, '<workspace-name>')} --no-interactive
\`\`\`

This will create a new workspace within the \`<workspace-name>\` directory.

If you are already inside an empty directory intended for this project, you can pass \`.\` as the workspace name to create the workspace in the current directory:

\`\`\`bash
${buildCreateNxWorkspaceCommand(packageManager, '.')} --no-interactive
\`\`\`

Note that this will prompt for an Infrastructure as Code provider (${IAC_PROVIDERS.join(', ')}).
If you know the preferred option, pass ${IAC_PROVIDERS.map((iac) => `\`--iacProvider=${iac}\``).join(' or ')} to the above command to skip the prompt.
  `,
        },
      ],
    }),
  );
};
