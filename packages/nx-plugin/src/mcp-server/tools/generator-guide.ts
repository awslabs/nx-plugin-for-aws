/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NxGeneratorInfo } from '../../utils/generators';
import { z } from 'zod';
import {
  renderGeneratorInfo,
  fetchGuidePagesForGenerator,
} from '../generator-info';
import { PackageManagerSchema } from '../schema';

/**
 * Add a tool which provides a detailed guide for an individual generator.
 *
 * The tool description points agents at `list-generators` for the list of
 * filterable options, rather than duplicating that inventory in every
 * response here.
 */
export const addGeneratorGuideTool = (
  server: McpServer,
  generators: NxGeneratorInfo[],
) => {
  server.registerTool(
    'generator-guide',
    {
      description:
        'Tool to retrieve detailed information about a specific generator. ' +
        'Pass `options` with the values you intend to use for any filterable option ' +
        '(e.g. computeType, iacProvider, auth, uxProvider, protocol) to receive only ' +
        'the guide content relevant to those choices — this cuts noise and avoids ' +
        'suggesting configuration from a different branch. The filterable keys and ' +
        'their valid values for each generator are listed by the `list-generators` ' +
        'tool; call it first if you are not sure which keys to pass. When `options` ' +
        'is omitted, every conditional section is included and prefixed with a ' +
        '`> [!NOTE] Only when …` marker so you can see the branching condition.',
      inputSchema: {
        packageManager: PackageManagerSchema,
        generator: z.enum(generators.map((g) => g.id)),
        options: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            'Optional map of generator option values (e.g. { computeType: "ServerlessApiGatewayRestApi", iacProvider: "CDK" }) used to filter the guide to content that applies to those choices.',
          ),
      },
    },
    async ({ packageManager, generator: generatorId, options }) => {
      const generator = generators.find((g) => g.id === generatorId);
      if (!generator) {
        throw new Error(
          `No generator found with id ${generatorId}. Available generators: ${generators.map((g) => g.id).join(' ,')}`,
        );
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `## ${renderGeneratorInfo(packageManager, generator)}

# Guide

${await fetchGuidePagesForGenerator(
  generator,
  generators,
  packageManager,
  undefined,
  options,
)}
`,
          },
        ],
      };
    },
  );
};
