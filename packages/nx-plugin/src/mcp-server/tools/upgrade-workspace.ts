/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NxGeneratorInfo } from '../../utils/generators.js';
import { fetchGuidePages } from '../generator-info.js';
import { PackageManagerSchema } from '../schema.js';

/** The guide page backing this tool, so it never drifts from the docs. */
const UPGRADING_GUIDE = 'upgrading';

/**
 * Add a tool which guides an agent through upgrading Nx and @aws/nx-plugin in a
 * workspace, returning the `upgrading` docs page.
 */
export const addUpgradeWorkspaceTool = (
  server: McpServer,
  generators: NxGeneratorInfo[],
) => {
  server.registerTool(
    'upgrade-workspace',
    {
      title: 'Upgrade Workspace',
      description:
        'Tool for upgrading Nx and the Nx Plugin for AWS in a workspace. Use this when a user wants to update @aws/nx-plugin or Nx to a newer version, or asks how to run migrations with nx migrate.',
      inputSchema: {
        packageManager: PackageManagerSchema.optional(),
      },
    },
    async ({ packageManager }) => {
      const guide = await fetchGuidePages(
        [UPGRADING_GUIDE],
        generators,
        packageManager,
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: guide,
          },
        ],
      };
    },
  );
};
