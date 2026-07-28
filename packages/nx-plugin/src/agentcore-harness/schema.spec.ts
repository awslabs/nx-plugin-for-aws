/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import GeneratorsJson from '../../generators.json' with { type: 'json' };
import {
  type ITsDepVersion,
  TS_VERSIONS,
  withVersions,
} from '../utils/versions';
import {
  ALLOWED_TOOLS_MAX_ITEMS,
  ALLOWED_TOOLS_MIN_ITEMS,
  DEFAULT_HARNESS_ALLOWED_TOOLS,
  DEFAULT_HARNESS_DIRECTORY,
  DEFAULT_HARNESS_MODEL_ID,
  DEFAULT_HARNESS_SYSTEM_PROMPT,
} from './resolve-options';
import type { AgentcoreHarnessGeneratorSchema } from './schema';
import harnessSchema from './schema.json' with { type: 'json' };

const NX_PLUGIN_ROOT = resolve(import.meta.dirname, '..', '..');
const WORKSPACE_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');

interface SchemaPropertyDefinition {
  type?: string;
  description?: string;
  pattern?: string;
  enum?: string[];
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  multipleOf?: number;
  items?: { type?: string; pattern?: string };
  $default?: { $source?: string; index?: number };
  'x-prompt'?: string;
  'x-priority'?: string;
  default?: unknown;
}

const SCHEMA_PROPERTIES: Record<string, SchemaPropertyDefinition> =
  harnessSchema.properties;

/**
 * Compile-time fixture for the schema.json / schema.d.ts parity check
 * (requirement 1.14). `Record<keyof AgentcoreHarnessGeneratorSchema, ...>`
 * fails to compile when a property is added to or removed from the interface
 * without updating this fixture, and the runtime assertions below compare the
 * fixture against schema.json so both contracts stay aligned.
 */
const INTERFACE_CONTRACT: Record<
  keyof AgentcoreHarnessGeneratorSchema,
  { jsonType: 'string' | 'number' | 'boolean' | 'array'; optional: boolean }
> = {
  name: { jsonType: 'string', optional: false },
  directory: { jsonType: 'string', optional: true },
  subDirectory: { jsonType: 'string', optional: true },
  modelId: { jsonType: 'string', optional: true },
  systemPrompt: { jsonType: 'string', optional: true },
  allowedTools: { jsonType: 'array', optional: true },
  maxIterations: { jsonType: 'number', optional: true },
  maxTokens: { jsonType: 'number', optional: true },
  timeoutSeconds: { jsonType: 'number', optional: true },
  infra: { jsonType: 'string', optional: true },
  iac: { jsonType: 'string', optional: true },
  preferInstallDependencies: { jsonType: 'boolean', optional: true },
};

describe('agentcore-harness schema contract', () => {
  describe('schema.json option contract', () => {
    it('exposes exactly the public MVP options', () => {
      expect(Object.keys(SCHEMA_PROPERTIES).sort()).toEqual(
        [
          'name',
          'directory',
          'subDirectory',
          'modelId',
          'systemPrompt',
          'allowedTools',
          'maxIterations',
          'maxTokens',
          'timeoutSeconds',
          'infra',
          'iac',
          'preferInstallDependencies',
        ].sort(),
      );
    });

    it('requires only the name option', () => {
      expect(harnessSchema.required).toEqual(['name']);
    });

    it('prompts for name with an argv positional default', () => {
      expect(SCHEMA_PROPERTIES.name.$default).toEqual({
        $source: 'argv',
        index: 0,
      });
      expect(SCHEMA_PROPERTIES.name['x-prompt']).toBe(
        'What would you like to call your AgentCore Harness?',
      );
    });

    it('prompts for infra and iac with the exact wording', () => {
      expect(SCHEMA_PROPERTIES.infra['x-prompt']).toBe(
        'How would you like to host your harness?',
      );
      expect(SCHEMA_PROPERTIES.iac['x-prompt']).toBe(
        'Which provider would you like to manage your infrastructure? (default: inherit)',
      );
    });

    it('declares first-class prompt metadata for every prompted option', () => {
      // Requirement 1.5: name, placement, model ID, system prompt, allowed
      // tools, execution limits, infrastructure mode and IaC provider are
      // first-class prompts.
      const promptedOptions = [
        'name',
        'directory',
        'subDirectory',
        'modelId',
        'systemPrompt',
        'allowedTools',
        'maxIterations',
        'maxTokens',
        'timeoutSeconds',
        'infra',
        'iac',
      ];
      for (const option of promptedOptions) {
        expect(SCHEMA_PROPERTIES[option]['x-priority'], option).toBe(
          'important',
        );
      }
      for (const option of Object.keys(SCHEMA_PROPERTIES)) {
        expect(SCHEMA_PROPERTIES[option].description, option).toMatch(/\S/);
      }
    });

    it('documents the exact creation defaults in option descriptions', () => {
      expect(SCHEMA_PROPERTIES.modelId.description).toContain(
        DEFAULT_HARNESS_MODEL_ID,
      );
      expect(SCHEMA_PROPERTIES.systemPrompt.description).toContain(
        DEFAULT_HARNESS_SYSTEM_PROMPT,
      );
      expect(SCHEMA_PROPERTIES.allowedTools.description).toContain(
        DEFAULT_HARNESS_ALLOWED_TOOLS[0],
      );
      expect(SCHEMA_PROPERTIES.directory.description).toContain(
        DEFAULT_HARNESS_DIRECTORY,
      );
    });

    it('declares no JSON Schema default so omitted values stay undefined', () => {
      // Omission provenance: generator-side resolution must be able to
      // distinguish omitted options from explicitly supplied values, so no
      // optional generator value may carry a JSON Schema `default`.
      for (const [option, definition] of Object.entries(SCHEMA_PROPERTIES)) {
        expect('default' in definition, option).toBe(false);
      }
    });

    it('validates non-whitespace strings for name, modelId and systemPrompt', () => {
      for (const option of ['name', 'modelId', 'systemPrompt']) {
        const pattern = new RegExp(SCHEMA_PROPERTIES[option].pattern);
        expect(pattern.test('a'), option).toBe(true);
        expect(pattern.test('  \t '), option).toBe(false);
        expect(pattern.test(''), option).toBe(false);
      }
    });

    it('bounds allowedTools to 1..64 non-whitespace entries', () => {
      const allowedTools = SCHEMA_PROPERTIES.allowedTools;
      expect(allowedTools.type).toBe('array');
      expect(allowedTools.minItems).toBe(ALLOWED_TOOLS_MIN_ITEMS);
      expect(allowedTools.maxItems).toBe(ALLOWED_TOOLS_MAX_ITEMS);
      expect(ALLOWED_TOOLS_MIN_ITEMS).toBe(1);
      expect(ALLOWED_TOOLS_MAX_ITEMS).toBe(64);
      expect(allowedTools.items?.type).toBe('string');
      const itemPattern = new RegExp(allowedTools.items?.pattern);
      expect(itemPattern.test('@builtin')).toBe(true);
      expect(itemPattern.test('   ')).toBe(false);
    });

    it('validates execution limits as positive integers', () => {
      for (const option of ['maxIterations', 'maxTokens', 'timeoutSeconds']) {
        const definition = SCHEMA_PROPERTIES[option];
        expect(definition.type, option).toBe('number');
        expect(definition.minimum, option).toBe(1);
        expect(definition.multipleOf, option).toBe(1);
      }
    });

    it('rejects absolute and parent-traversal placement paths', () => {
      for (const option of ['directory', 'subDirectory']) {
        const pattern = new RegExp(SCHEMA_PROPERTIES[option].pattern);
        expect(pattern.test('packages'), option).toBe(true);
        expect(pattern.test('apps/nested'), option).toBe(true);
        // '..' only counts as traversal when it is a whole path segment.
        expect(pattern.test('a..b'), option).toBe(true);
        expect(pattern.test('..'), option).toBe(false);
        expect(pattern.test('../escape'), option).toBe(false);
        expect(pattern.test('a/../b'), option).toBe(false);
        expect(pattern.test('foo/..'), option).toBe(false);
        expect(pattern.test('/absolute'), option).toBe(false);
        expect(pattern.test('C:/windows'), option).toBe(false);
        expect(pattern.test('   '), option).toBe(false);
      }
    });
  });

  describe('schema.json / schema.d.ts parity', () => {
    it('defines the same option names in both contracts', () => {
      expect(Object.keys(SCHEMA_PROPERTIES).sort()).toEqual(
        Object.keys(INTERFACE_CONTRACT).sort(),
      );
    });

    it('declares matching value types for every option', () => {
      for (const [option, contract] of Object.entries(INTERFACE_CONTRACT)) {
        expect(SCHEMA_PROPERTIES[option].type, option).toBe(contract.jsonType);
      }
    });

    it('declares matching optionality for every option', () => {
      const requiredFromInterface = Object.entries(INTERFACE_CONTRACT)
        .filter(([, contract]) => !contract.optional)
        .map(([option]) => option);
      expect(harnessSchema.required).toEqual(requiredFromInterface);

      // Compile-time confirmation of the fixture's optionality flags: `name`
      // alone must satisfy the interface (every other option is optional)...
      const minimalOptions: AgentcoreHarnessGeneratorSchema = { name: 'x' };
      expect(minimalOptions.name).toBe('x');
      // ...and omitting `name` must not type-check.
      // @ts-expect-error name is required by the interface
      const missingName: AgentcoreHarnessGeneratorSchema = {};
      expect(missingName).toEqual({});
    });

    it('declares matching enum values for infra and iac', () => {
      // Record<union, true> fails to compile if schema.d.ts and these
      // literals drift in either direction.
      const infraValues: Record<
        NonNullable<AgentcoreHarnessGeneratorSchema['infra']>,
        true
      > = {
        agentcore: true,
        none: true,
      };
      expect(SCHEMA_PROPERTIES.infra.enum).toEqual(Object.keys(infraValues));

      const iacValues: Record<
        NonNullable<AgentcoreHarnessGeneratorSchema['iac']>,
        true
      > = {
        inherit: true,
        cdk: true,
        terraform: true,
      };
      expect(SCHEMA_PROPERTIES.iac.enum).toEqual(Object.keys(iacValues));
    });
  });

  describe('public registration (generators.json)', () => {
    const registration = (
      GeneratorsJson.generators as Record<
        string,
        {
          factory: string;
          schema: string;
          description: string;
          metric: string;
          hidden?: boolean;
          guidePages?: string[];
        }
      >
    )['agentcore-harness'];

    it('registers the public agentcore-harness generator', () => {
      expect(registration).toBeDefined();
      expect(registration.factory).toBe('./src/agentcore-harness/generator');
      expect(registration.schema).toBe('./src/agentcore-harness/schema.json');
      expect(registration.description).toBe(
        'Generate an AgentCore Harness project',
      );
      // Public: registration must not be hidden.
      expect(registration.hidden).toBeUndefined();
    });

    it('references a factory and schema that exist on disk', () => {
      expect(
        existsSync(join(NX_PLUGIN_ROOT, `${registration.factory}.ts`)),
      ).toBe(true);
      expect(existsSync(join(NX_PLUGIN_ROOT, registration.schema))).toBe(true);
    });

    it('associates the public English guide page', () => {
      expect(registration.guidePages).toEqual(['agentcore-harness']);
      const guide = readFileSync(
        join(
          WORKSPACE_ROOT,
          'docs/src/content/docs/en/guides/agentcore-harness.mdx',
        ),
        'utf-8',
      );
      expect(guide).toMatch(/^generator:\s*agentcore-harness\s*$/m);
    });

    it('uses metric g68, unique to this generator', () => {
      expect(registration.metric).toBe('g68');
      // generators.json contains pre-existing duplicate metrics among other
      // generators (eg. g43), so assert that g68 specifically is used by
      // exactly one registration rather than asserting global uniqueness.
      const usages = Object.values(
        GeneratorsJson.generators as Record<string, { metric: string }>,
      ).filter((generator) => generator.metric === 'g68');
      expect(usages).toHaveLength(1);
    });
  });

  describe('centralized versions', () => {
    const EXACT_SEMVER = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

    it('pins the AgentCore data-plane client to the exact AWS SDK baseline', () => {
      expect(TS_VERSIONS['@aws-sdk/client-bedrock-agentcore']).toBe('3.1090.0');
      // The harness client must share the exact version baseline used by the
      // other repository AWS SDK clients.
      expect(TS_VERSIONS['@aws-sdk/client-bedrock-agentcore']).toBe(
        TS_VERSIONS['@aws-sdk/client-s3'],
      );
      expect(TS_VERSIONS['@aws-sdk/client-bedrock-agentcore']).toMatch(
        EXACT_SEMVER,
      );
    });

    it('provides exact centralized versions for generated harness dependencies', () => {
      const requiredPackages: ITsDepVersion[] = [
        '@aws-sdk/client-bedrock-agentcore',
        '@aws-sdk/client-appconfigdata',
        '@aws-lambda-powertools/parameters',
        'tsx',
        'typescript',
        '@types/node',
      ];
      for (const pkg of requiredPackages) {
        expect(TS_VERSIONS[pkg], pkg).toMatch(EXACT_SEMVER);
      }
      // Version lookup resolves every required package without throwing.
      expect(withVersions(requiredPackages)).toMatchObject({
        '@aws-sdk/client-bedrock-agentcore': '3.1090.0',
      });
    });

    it('fails version lookup for packages missing from the registry', () => {
      expect(() =>
        withVersions(['not-a-registered-package' as unknown as ITsDepVersion]),
      ).toThrow(/No centralized version registered/);
    });

    it('pins fast-check exactly in the root development dependencies', () => {
      const rootPackageJson = JSON.parse(
        readFileSync(join(WORKSPACE_ROOT, 'package.json'), 'utf-8'),
      );
      expect(rootPackageJson.devDependencies['fast-check']).toMatch(
        EXACT_SEMVER,
      );
    });
  });
});
