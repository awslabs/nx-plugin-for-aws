/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PackageManagerSchema } from '../schema';
import {
  renderFilterableOptionsAsync,
  renderGeneratorInfo,
} from '../generator-info';
import { NxGeneratorInfo } from '../../utils/generators';

/**
 * Adds a tool which lists details about the available generators.
 *
 * Each entry carries a "Filterable options" section that tells the agent
 * which keys it can pass to `generator-guide` to narrow the guide response
 * to only the branches relevant to its selection. The keys come from two
 * sources, merged transparently:
 *   - Enum properties from the generator's JSON schema.
 *   - The union of `when:` frontmatter keys across the generator's guide
 *     pages (lets multi-variant generators like `connection` surface
 *     `sourceType` / `targetType` / `protocol` without any bespoke config).
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
    async ({ packageManager }) => {
      const entries = await Promise.all(
        generators.map(async (g) => {
          const info = renderGeneratorInfo(packageManager, g);
          const filterable = await renderFilterableOptionsAsync(g);
          return `### ${info}${filterable ? `\n${filterable}\n` : ''}`;
        }),
      );
      const guidance =
        'Before running any generator below, call `generator-guide` with the ' +
        "generator's id and `options` populated from its `generator-guide options` " +
        'list — the guide is returned narrowed to the branches that apply to ' +
        'those choices, which keeps you from mixing configuration from a ' +
        'different variant.';
      return {
        content: [
          {
            type: 'text' as const,
            text: `## Available Generators\n\n${guidance}\n\n${entries.join('\n\n')}\n`,
          },
        ],
      };
    },
  );
};
