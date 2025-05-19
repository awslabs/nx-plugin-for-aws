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
  server.tool(
    'generator-guide',
    {
      packageManager: PackageManagerSchema,
      generator: z.custom<string>((v) =>
        generators.map((g) => g.id).includes(v),
      ),
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
            type: 'text',
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
