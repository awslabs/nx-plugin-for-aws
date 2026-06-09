/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildCreateNxWorkspaceCommand } from '../../utils/commands';
import { IAC_PROVIDERS } from '../../utils/iac-providers';
import { PackageManagerSchema } from '../schema';

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
${buildCreateNxWorkspaceCommand(packageManager, '<workspace-name>', undefined, 'next')} --no-interactive
\`\`\`

This will create a new workspace within the \`<workspace-name>\` directory.

If you are already inside an empty directory intended for this project, you can pass \`.\` as the workspace name to create the workspace in the current directory:

\`\`\`bash
${buildCreateNxWorkspaceCommand(packageManager, '.', undefined, 'next')} --no-interactive
\`\`\`

Note that this will prompt for an Infrastructure as Code provider (${IAC_PROVIDERS.join(', ')}).
If you know the preferred option, pass ${IAC_PROVIDERS.map((iac) => `\`--iac=${iac}\``).join(' or ')} to the above command to skip the prompt.

Additional options:
- \`--no-gitSecrets\`: Opt out of the default git-secrets pre-commit hook (prevents committing AWS credentials)

Refer to the \`general-guidance\` tool for full workspace documentation including structure, common commands, and configuration.
  `,
        },
      ],
    }),
  );
};
