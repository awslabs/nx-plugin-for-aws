/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import fs from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { camelCase } from '../utils/names.js';
import { listGenerators } from '../utils/nx.js';
import { filterableValuesForProperty } from './schema-registry.js';
import { createServer } from './server.js';

// Generator ids in `nx g @aws/nx-plugin:<id>` commands or as `<lang>#<name>` in backticks.
const referencedGenerators = (text: string): string[] => [
  ...new Set(
    [...text.matchAll(/@aws\/nx-plugin:([\w#-]+)|`([a-z]+#[\w#-]+)`/g)].map(
      ([, command, quoted]) => command ?? quoted,
    ),
  ),
];

const unlisted = (ids: string[]): string[] => {
  const listed = new Set(listGenerators().map((g) => g.id));
  return ids.filter((id) => !listed.has(id));
};

// Flags Nx's CLI accepts for every generator, which no generator schema declares.
const NX_CLI_FLAGS = new Set(['interactive', 'dryRun', 'verbose', 'quiet']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// A listed generator's options by camelCase name and alias, mapped to their allowed values.
const schemaOptions = (
  generatorId: string,
): Map<string, string[] | undefined> | undefined => {
  const info = listGenerators().find((g) => g.id === generatorId);
  if (!info) return undefined;
  const schema: unknown = JSON.parse(
    fs.readFileSync(info.resolvedSchemaPath, 'utf-8'),
  );
  const properties =
    isRecord(schema) && isRecord(schema.properties) ? schema.properties : {};
  const options = new Map<string, string[] | undefined>();
  for (const [name, prop] of Object.entries(properties)) {
    if (!isRecord(prop)) continue;
    const values = filterableValuesForProperty({
      type: typeof prop.type === 'string' ? prop.type : undefined,
      enum: Array.isArray(prop.enum) ? prop.enum : undefined,
    });
    options.set(camelCase(name), values);
    if (typeof prop.alias === 'string') {
      options.set(camelCase(prop.alias), values);
    }
  }
  return options;
};

// Undeclared options or disallowed values in each `nx g @aws/nx-plugin:<id>` command.
const invalidGeneratorOptions = (text: string): string[] =>
  [...text.matchAll(/nx g @aws\/nx-plugin:([\w#-]+)([^`\n&]*)/g)].flatMap(
    ([, generatorId, args]) => {
      const options = schemaOptions(generatorId);
      if (!options) return [`${generatorId}: not a listed generator`];
      return [...args.matchAll(/--([\w-]+)(?:[= ]([^\s\\-]\S*))?/g)].flatMap(
        ([arg, flag, explicitValue]) => {
          const negated = flag.startsWith('no-');
          const option = camelCase(negated ? flag.slice(3) : flag);
          const value = negated ? 'false' : explicitValue;
          if (NX_CLI_FLAGS.has(option)) return [];
          if (!options.has(option)) {
            return [`${generatorId} ${arg}: not a declared option`];
          }
          const accepted = options.get(option);
          return accepted && value !== undefined && !accepted.includes(value)
            ? [`${generatorId} ${arg}: expected one of ${accepted.join('|')}`]
            : [];
        },
      );
    },
  );

const GENERATED_SKILL_FILES = [
  'skills/nx-plugin-for-aws/SKILL.md',
  'powers/nx-plugin-for-aws/POWER.md',
];

const readRepoFile = (file: string): string =>
  fs.readFileSync(join(__dirname, '../../../..', file), 'utf-8');

describe('MCP Server', () => {
  let client: Client;
  let server: McpServer;

  beforeEach(async () => {
    // Force the local-file probes in fetchGuidePages / fetchSnippet to miss
    // so the test's `global.fetch` mock is the one returning guide content.
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    // Create a new client instance
    client = new Client({
      name: 'test-client',
      version: '1.0.0',
    });

    // Create the server
    server = createServer();

    // Create linked transports for client and server
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    // Connect both client and server
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  it('should initialize with the correct server information', async () => {
    // Get server info from client
    const instructions = client.getInstructions();
    expect(instructions).toContain('Tool Selection Guide');
  });

  it('should list available tools', async () => {
    // List tools using client
    const tools = await client.listTools();

    // Verify tools are registered
    const toolNames = tools.tools.map((tool) => tool.name);
    expect(toolNames).toContain('general-guidance');
    expect(toolNames).toContain('create-workspace-command');
    expect(toolNames).toContain('list-generators');
    expect(toolNames).toContain('generator-guide');
    expect(toolNames).toContain('add-to-existing-project');
    expect(toolNames).toContain('best-practices');
  });

  it('should have a description for every tool', async () => {
    // Amazon Q CLI fails to load tools unless each one has a description
    for (const tool of (await client.listTools()).tools ?? []) {
      expect(tool.description).toBeDefined();
    }
  });

  it('should execute create-workspace-command tool', async () => {
    // Call the tool using client
    const result = await client.callTool({
      name: 'create-workspace-command',
      arguments: {
        packageManager: 'pnpm',
      },
    });

    // Verify result
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('pnpm create @aws/nx-workspace');
  });

  it('should execute list-generators tool', async () => {
    // Call the tool using client
    const result = await client.callTool({
      name: 'list-generators',
      arguments: {
        packageManager: 'pnpm',
      },
    });

    // Verify result
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Available Generators');
    expect(result.content[0].text).toContain('ts#project');
  });

  it('should execute general-guidance tool', async () => {
    // Call the tool using client
    const result = await client.callTool({
      name: 'general-guidance',
      arguments: {},
    });

    // Verify result
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Nx Plugin for AWS Guidance');
    expect(result.content[0].text).toContain('Getting Started');
    expect(result.content[0].text).toContain('Nx Primer');
    expect(result.content[0].text).toContain('General Instructions');
  });

  // General guidance up to the inlined guide pages, which aren't checked.
  const generalGuidance = async (): Promise<string> => {
    const result = await client.callTool({
      name: 'general-guidance',
      arguments: {},
    });
    const text = result.content[0].text as string;
    expect(text).toContain('## Detailed Guides');
    const [guidance] = text.split('## Detailed Guides');
    return guidance;
  };

  it('should only reference generators listed by the MCP server in general-guidance', async () => {
    const referenced = referencedGenerators(await generalGuidance());

    expect(referenced.length).toBeGreaterThan(0);
    expect(unlisted(referenced)).toEqual([]);
  });

  it('should only pass declared generator options in general-guidance', async () => {
    const guidance = await generalGuidance();

    expect(guidance).toContain('nx g @aws/nx-plugin:');
    expect(invalidGeneratorOptions(guidance)).toEqual([]);
  });

  it.each(GENERATED_SKILL_FILES)(
    'should only reference generators listed by the MCP server in %s',
    (file) => {
      const referenced = referencedGenerators(readRepoFile(file));

      expect(referenced.length).toBeGreaterThan(0);
      expect(unlisted(referenced)).toEqual([]);
    },
  );

  it.each(GENERATED_SKILL_FILES)(
    'should only pass declared generator options in %s',
    (file) => {
      const skill = readRepoFile(file);

      expect(skill).toContain('nx g @aws/nx-plugin:');
      expect(invalidGeneratorOptions(skill)).toEqual([]);
    },
  );

  it('should execute generator-guide tool with valid generator', async () => {
    const result = await client.callTool({
      name: 'generator-guide',
      arguments: {
        packageManager: 'pnpm',
        generator: 'ts#project',
      },
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('ts#project');
    expect(result.content[0].text).toContain('Description:');
  });

  it('should post process guide pages fetched by the generator-guide tool', async () => {
    const result = await client.callTool({
      name: 'generator-guide',
      arguments: {
        packageManager: 'pnpm',
        generator: 'ts#project',
      },
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    // Verify NxCommands are post-processed into code blocks with the package manager prefix
    expect(result.content[0].text).toContain('pnpm nx');
  });

  it('should register the same tools as the published nx-plugin-mcp entry point', async () => {
    // `packages/nx-plugin-mcp/src/index.ts` builds its own McpServer rather
    // than calling `createServer`, so a tool added here alone never reaches
    // the published package.
    const publishedEntryPoint = fs.readFileSync(
      join(__dirname, '../../../nx-plugin-mcp/src/index.ts'),
      'utf-8',
    );

    const registrars = [
      ...fs
        .readFileSync(join(__dirname, 'server.ts'), 'utf-8')
        .matchAll(/^\s*(add\w+Tool)\(server/gm),
    ].map(([, name]) => name);

    expect(registrars.length).toBeGreaterThan(0);
    for (const registrar of registrars) {
      expect(publishedEntryPoint).toContain(`${registrar}(server`);
    }
  });

  it('should throw an error when generator-guide is called with an invalid generator', async () => {
    // Call the tool with an invalid generator ID
    const result = await client.callTool({
      name: 'generator-guide',
      arguments: {
        packageManager: 'pnpm',
        generator: 'invalid-generator-id-that-does-not-exist',
      },
    });
    expect(result.isError).toBe(true);
  });
});
