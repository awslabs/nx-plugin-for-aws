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
const EXISTING_PROJECT_GUIDE = 'existing-project';

/**
 * Add a tool which guides an agent through adding @aws/nx-plugin to an
 * existing Nx or non-Nx workspace. Returns the `existing-project` docs page,
 * which includes the full adoption steps and troubleshooting reference.
 */
export const addToExistingProjectTool = (
  server: McpServer,
  generators: NxGeneratorInfo[],
) => {
  server.registerTool(
    'add-to-existing-project',
    {
      title: 'Add to Existing Project',
      description:
        'Tool for adding the Nx Plugin for AWS to an existing Nx workspace or non-Nx monorepo. Use this when a user wants to adopt @aws/nx-plugin in a project that was not created with the plugin preset, or hits configuration errors when running generators in such a workspace.',
      inputSchema: {
        packageManager: PackageManagerSchema.optional(),
      },
    },
    async ({ packageManager }) => {
      const guide = await fetchGuidePages(
        [EXISTING_PROJECT_GUIDE],
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
