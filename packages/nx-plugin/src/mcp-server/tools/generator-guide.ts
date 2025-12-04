/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { NxGeneratorInfo } from '../../utils/nx';
import { z } from 'zod';
import {
  renderGeneratorInfo,
  fetchGuidePagesForGenerator,
} from '../generator-info';
import { PackageManagerSchema } from '../schema';

/**
 * Add a tool which provides a detailed guide for an individual generator
 */
export const addGeneratorGuideTool = (
  server: McpServer,
  generators: NxGeneratorInfo[],
) => {
  server.registerTool(
    'generator-guide',
    {
      description:
        'Tool to retrieve detailed information about a specific generator.',
      inputSchema: {
        packageManager: PackageManagerSchema,
        generator: z.enum(generators.map((g) => g.id)),
      },
    },
    async ({ packageManager, generator: generatorId }) => {
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

${await fetchGuidePagesForGenerator(generator, generators, packageManager)}
`,
          },
        ],
      };
    },
  );
};
