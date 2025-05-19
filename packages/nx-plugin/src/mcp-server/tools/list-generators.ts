/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PackageManagerSchema } from '../schema';
import { renderGeneratorInfo } from '../generator-info';
import { NxGeneratorInfo } from '../../utils/nx';

/**
 * Adds a tool which lists details about the available generators
 */
export const addListGeneratorsTool = (
  server: McpServer,
  generators: NxGeneratorInfo[],
) => {
  server.tool(
    'list-generators',
    { packageManager: PackageManagerSchema },
    ({ packageManager }) => ({
      content: [
        {
          type: 'text',
          text: `## Available Generators

  ${generators.map((g) => `### ${renderGeneratorInfo(packageManager, g)}`).join('\n\n')}
  `,
        },
      ],
    }),
  );
};
