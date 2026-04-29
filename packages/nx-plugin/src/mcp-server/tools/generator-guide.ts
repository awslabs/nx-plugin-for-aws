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
import fs from 'fs';

interface SchemaProperty {
  type?: string;
  enum?: unknown[];
  default?: unknown;
  description?: string;
}

interface GeneratorSchema {
  properties?: Record<string, SchemaProperty>;
}

/**
 * Load the filterable options for a generator so we can surface them back to
 * the agent in the tool response header. Agents use this to self-correct if
 * they pass an invalid value and to narrow filters on subsequent calls.
 *
 * Sources:
 *   - Enum properties from the generator's JSON schema.
 *   - `extraFilterableOptions` from `generators.json` — used for MCP-only
 *     keys that don't correspond to a schema property (e.g. the connection
 *     generator's `sourceType` / `targetType`).
 */
const loadFilterableOptions = (
  info: NxGeneratorInfo,
): Array<{
  key: string;
  enum: string[];
  default?: string;
  description?: string;
}> => {
  const options: Array<{
    key: string;
    enum: string[];
    default?: string;
    description?: string;
  }> = [];

  try {
    const schema = JSON.parse(
      fs.readFileSync(info.resolvedSchemaPath, 'utf-8'),
    ) as GeneratorSchema;
    const props = schema.properties ?? {};
    for (const [key, prop] of Object.entries(props)) {
      if (!Array.isArray(prop.enum) || prop.enum.length === 0) continue;
      options.push({
        key,
        enum: (prop.enum as unknown[]).map((v) => String(v)),
        default: prop.default !== undefined ? String(prop.default) : undefined,
        description: prop.description,
      });
    }
  } catch {
    // Fall through — schema load failure shouldn't block extra options.
  }

  for (const [key, extra] of Object.entries(
    info.extraFilterableOptions ?? {},
  )) {
    options.push({
      key,
      enum: [...extra.enum],
      description: extra.description,
    });
  }

  return options;
};

const renderOptionsReport = (
  filterable: ReturnType<typeof loadFilterableOptions>,
  supplied: Record<string, string> | undefined,
): string => {
  if (filterable.length === 0) return '';

  const suppliedKeys = new Set(Object.keys(supplied ?? {}));
  const lines: string[] = [];
  lines.push(
    'Filterable options (pass any of these in `options` to narrow the guide):',
  );
  for (const opt of filterable) {
    const applied = suppliedKeys.has(opt.key)
      ? ` [applied: ${supplied![opt.key]}]`
      : '';
    const def = opt.default ? ` (default: ${opt.default})` : '';
    lines.push(`- ${opt.key}: ${opt.enum.join(' | ')}${def}${applied}`);
  }

  const ignored = Object.keys(supplied ?? {}).filter(
    (k) => !filterable.some((o) => o.key === k),
  );
  if (ignored.length > 0) {
    lines.push(`Ignored (not filterable): ${ignored.join(', ')}`);
  }
  return lines.join('\n');
};

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
        'Tool to retrieve detailed information about a specific generator. ' +
        'Pass `options` with selected generator option values (e.g. computeType, iacProvider, auth, uxProvider, protocol) ' +
        'to receive only the guide content relevant to those choices — this cuts noise and avoids suggesting ' +
        'configuration from a different branch. When `options` is omitted, every conditional section is included ' +
        'and prefixed with a `> [!NOTE] Only when …` marker so you can see the branching condition. ' +
        'The response begins with a "Filterable options" header listing the enums each option supports; ' +
        'use it to self-correct if you pass a value outside the enum.',
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

      const filterable = loadFilterableOptions(generator);
      const optionsReport = renderOptionsReport(filterable, options);

      return {
        content: [
          {
            type: 'text' as const,
            text: `## ${renderGeneratorInfo(packageManager, generator)}
${optionsReport ? `\n${optionsReport}\n` : ''}
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
