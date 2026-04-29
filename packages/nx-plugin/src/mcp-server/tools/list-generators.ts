/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PackageManagerSchema } from '../schema';
import {
  renderFilterableOptions,
  renderGeneratorInfo,
} from '../generator-info';
import { NxGeneratorInfo } from '../../utils/generators';

/**
 * Adds a tool which lists details about the available generators.
 *
 * Each entry carries a "Filterable options" section that tells the agent
 * which keys it can pass to `generator-guide` to narrow the guide response
 * to only the branches relevant to its selection.
 */
export const addListGeneratorsTool = (
  server: McpServer,
  generators: NxGeneratorInfo[],
) => {
  server.registerTool(
    'list-generators',
    {
      description:
        'Tool to discover the available generators and how to run them. ' +
        'Each entry includes a "Filterable options" section — pass those ' +
        'keys to `generator-guide` before invoking a generator so the guide ' +
        'is narrowed to the variant you intend to scaffold.',
      inputSchema: { packageManager: PackageManagerSchema },
    },
    ({ packageManager }) => ({
      content: [
        {
          type: 'text' as const,
          text: `## Available Generators

${generators
  .map((g) => {
    const info = renderGeneratorInfo(packageManager, g);
    const filterable = renderFilterableOptions(g);
    return `### ${info}${filterable ? `\n${filterable}\n` : ''}`;
  })
  .join('\n\n')}
`,
        },
      ],
    }),
  );
};
