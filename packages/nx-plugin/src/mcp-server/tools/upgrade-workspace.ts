/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { NxGeneratorInfo } from '../../utils/generators';
import { fetchGuidePages } from '../generator-info';
import { PackageManagerSchema } from '../schema';

/**
 * The guide page (under `get_started/`) that backs this tool, so the tool and
 * the published docs never drift.
 */
const UPGRADING_GUIDE = 'upgrading';

/**
 * Add a tool which guides an agent through upgrading Nx and @aws/nx-plugin in
 * a workspace. Returns the `upgrading` docs page, which covers the nx migrate
 * flow for both packages, including deterministic and agentic migrations.
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
