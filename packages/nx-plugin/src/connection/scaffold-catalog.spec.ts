/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import GeneratorsJson from '../../generators.json' with { type: 'json' };
import {
  CONNECTION_CONSTRAINTS,
  CONNECTION_ENDPOINT_TYPES,
  CONNECTION_ORDERING,
  CONNECTION_PREFERENCES,
  deriveScaffoldRecipe,
  SELF_CONNECTION_DISALLOWED,
} from './scaffold-catalog';
import { nodeSchemaResolver, SCAFFOLD_RECIPES } from './schema-resolver';
import { SUPPORTED_CONNECTIONS } from './supported-connections';

/**
 * The docs graph builder derives its palette and edges from this catalogue, so a
 * generator or connection added to the plugin must reach the builder without
 * anyone remembering to update it. These tests fail when the catalogue falls
 * behind, rather than the builder silently dropping the new thing.
 */
describe('scaffold catalog', () => {
  const pluginRoot = join(import.meta.dirname, '..', '..');
  const generators = GeneratorsJson.generators as Record<
    string,
    { schema: string; hidden?: boolean }
  >;

  const readSchema = (generatorId: string) =>
    JSON.parse(
      readFileSync(join(pluginRoot, generators[generatorId].schema), 'utf-8'),
    );

  const endpointTypes = [
    ...new Set(
      SUPPORTED_CONNECTIONS.flatMap(({ source, target }) => [source, target]),
    ),
  ];

  it('should have a recipe for every type taking part in a supported connection', () => {
    const missing = endpointTypes.filter((type) => !(type in SCAFFOLD_RECIPES));
    expect(missing).toEqual([]);
  });

  it('should derive a recipe for every endpoint type without throwing', () => {
    // The derivation asserts its own invariants (the type is a generator, a
    // hidden one has a public wrapper, a component has a host), so a generator
    // shaped unexpectedly fails here with a specific message.
    for (const type of CONNECTION_ENDPOINT_TYPES) {
      expect(() =>
        deriveScaffoldRecipe(type, nodeSchemaResolver),
      ).not.toThrow();
    }
  });

  it('should derive the expected recipe for each endpoint type', () => {
    // Pins the derivation's output. A generator restructured such that the rules
    // infer something different shows up here as a diff rather than as a subtly
    // wrong command in the docs graph builder.
    expect(SCAFFOLD_RECIPES).toEqual({
      'agentcore-gateway': {
        label: 'AgentCore Gateway',
        generator: 'agentcore-gateway',
        kind: 'project',
      },
      'agentcore-harness': {
        label: 'AgentCore Harness',
        generator: 'agentcore-harness',
        kind: 'project',
      },
      'ts#trpc-api': {
        label: 'tRPC API',
        generator: 'ts#api',
        options: { framework: 'trpc' },
        kind: 'project',
      },
      'ts#smithy-api': {
        label: 'Smithy API',
        generator: 'ts#api',
        options: { framework: 'smithy' },
        kind: 'project',
      },
      'py#fast-api': {
        label: 'FastAPI',
        generator: 'py#api',
        options: { framework: 'fastapi' },
        kind: 'project',
      },
      'ts#react-website': {
        label: 'React Website',
        generator: 'ts#website',
        options: { framework: 'react' },
        kind: 'project',
      },
      'ts#rdb': {
        label: 'Relational Database',
        generator: 'ts#rdb',
        kind: 'project',
      },
      'py#rdb': {
        label: 'Relational Database',
        generator: 'py#rdb',
        kind: 'project',
      },
      'ts#dynamodb': {
        label: 'DynamoDB',
        generator: 'ts#dynamodb',
        kind: 'project',
      },
      'py#dynamodb': {
        label: 'DynamoDB',
        generator: 'py#dynamodb',
        kind: 'project',
      },
      'ts#agent': {
        label: 'Agent',
        generator: 'ts#agent',
        kind: 'component',
        host: {
          generator: 'ts#project',
          options: {},
          snakeCaseName: false,
        },
      },
      'py#agent': {
        label: 'Agent',
        generator: 'py#agent',
        kind: 'component',
        host: {
          generator: 'py#project',
          options: { type: 'application' },
          snakeCaseName: true,
        },
      },
      'ts#mcp-server': {
        label: 'MCP Server',
        generator: 'ts#mcp-server',
        kind: 'component',
        host: {
          generator: 'ts#project',
          options: {},
          snakeCaseName: false,
        },
      },
      'py#mcp-server': {
        label: 'MCP Server',
        generator: 'py#mcp-server',
        kind: 'component',
        host: {
          generator: 'py#project',
          options: { type: 'application' },
          snakeCaseName: true,
        },
      },
    });
  });

  it('should give every connectable generator an x-label', () => {
    // The palette shows this; without one a node would be labelled with its raw
    // generator id.
    for (const type of CONNECTION_ENDPOINT_TYPES) {
      const label = readSchema(type)['x-label'];
      expect(label, `${type}'s schema.json has no x-label`).toBeTruthy();
      expect(label).not.toEqual(type);
    }
  });

  it('should take each label from the schema rather than the generator id', () => {
    expect(SCAFFOLD_RECIPES['ts#trpc-api'].label).toBe('tRPC API');
    expect(SCAFFOLD_RECIPES['py#mcp-server'].label).toBe('MCP Server');
  });

  it('should reject an endpoint type that is not a generator', () => {
    expect(() =>
      deriveScaffoldRecipe('ts#not-a-generator', nodeSchemaResolver),
    ).toThrow(/is not a generator id/);
  });

  it('should run the public wrapper rather than a hidden generator', () => {
    // A hidden generator is an internal detail; the emitted command must name
    // something a user can actually run.
    for (const [type, recipe] of Object.entries(SCAFFOLD_RECIPES)) {
      expect(
        generators[recipe.generator].hidden ?? false,
        `${type} would run the hidden generator ${recipe.generator}`,
      ).toBe(false);
    }
  });

  it('should not have recipes for types no connection uses', () => {
    const unused = Object.keys(SCAFFOLD_RECIPES).filter(
      (type) => !endpointTypes.includes(type as (typeof endpointTypes)[number]),
    );
    expect(unused).toEqual([]);
  });

  it('should name a real generator in every recipe', () => {
    for (const [type, recipe] of Object.entries(SCAFFOLD_RECIPES)) {
      expect(generators, `${type} names an unknown generator`).toHaveProperty(
        recipe.generator,
      );
    }
  });

  it('should name a real generator for every component recipe host', () => {
    for (const [type, recipe] of Object.entries(SCAFFOLD_RECIPES)) {
      if (recipe.kind !== 'component') continue;
      const host = (recipe as { host?: { generator: string } }).host;
      expect(host, `${type} is a component but declares no host`).toBeDefined();
      expect(generators).toHaveProperty(host!.generator);
    }
  });

  it('should not declare a host for project recipes', () => {
    for (const [type, recipe] of Object.entries(SCAFFOLD_RECIPES)) {
      if (recipe.kind !== 'project') continue;
      expect(
        (recipe as { host?: unknown }).host,
        `${type} creates a project so needs no host`,
      ).toBeUndefined();
    }
  });

  it('should only pin variant options the generator schema accepts', () => {
    for (const [type, recipe] of Object.entries(SCAFFOLD_RECIPES)) {
      const options = (recipe as { options?: Record<string, string> }).options;
      if (!options) continue;
      const schema = readSchema(recipe.generator);
      for (const [option, value] of Object.entries(options)) {
        const property = schema.properties?.[option];
        expect(
          property,
          `${type} pins '${option}', absent from ${recipe.generator}'s schema`,
        ).toBeDefined();
        // A pinned value selects one variant, so it must be one the enum offers.
        if (property.enum) {
          expect(
            property.enum,
            `${type} pins ${option}=${value}, not in ${recipe.generator}'s enum`,
          ).toContain(value);
        }
      }
    }
  });

  it('should only pin host options the host generator schema accepts', () => {
    for (const [type, recipe] of Object.entries(SCAFFOLD_RECIPES)) {
      const host = (
        recipe as {
          host?: { generator: string; options?: Record<string, string> };
        }
      ).host;
      if (!host?.options) continue;
      const schema = readSchema(host.generator);
      for (const [option, value] of Object.entries(host.options)) {
        const property = schema.properties?.[option];
        expect(
          property,
          `${type}'s host pins '${option}', absent from ${host.generator}'s schema`,
        ).toBeDefined();
        if (property.enum) {
          expect(property.enum).toContain(value);
        }
      }
    }
  });

  it('should satisfy every required option of the generators it runs', () => {
    // The builder always supplies a name (or a project, for components), so any
    // other required option would leave the emitted command incomplete.
    const suppliedByBuilder = new Set(['name', 'project', 'type']);
    for (const [type, recipe] of Object.entries(SCAFFOLD_RECIPES)) {
      const schema = readSchema(recipe.generator);
      const options =
        (recipe as { options?: Record<string, string> }).options ?? {};
      const unmet = (schema.required ?? []).filter(
        (option: string) =>
          !suppliedByBuilder.has(option) && !(option in options),
      );
      expect(
        unmet,
        `${type} would run ${recipe.generator} without required option(s)`,
      ).toEqual([]);
    }
  });

  describe('connection constraints', () => {
    const connectionKeys = SUPPORTED_CONNECTIONS.map(
      ({ source, target }) => `${source} -> ${target}`,
    );

    it('should only constrain supported connections', () => {
      const unknown = Object.keys(CONNECTION_CONSTRAINTS).filter(
        (key) => !connectionKeys.includes(key),
      );
      expect(unknown).toEqual([]);
    });

    it('should only prefer options for supported connections', () => {
      const unknown = Object.keys(CONNECTION_PREFERENCES).filter(
        (key) => !connectionKeys.includes(key),
      );
      expect(unknown).toEqual([]);
    });

    it('should prefer values the constrained option can actually hold', () => {
      for (const [key, preferences] of Object.entries(
        CONNECTION_PREFERENCES as Record<
          string,
          readonly {
            side: 'source' | 'target';
            option: string;
            value: string;
          }[]
        >,
      )) {
        const [source, target] = key.split(' -> ');
        for (const preference of preferences) {
          const type = preference.side === 'source' ? source : target;
          const recipe = (SCAFFOLD_RECIPES as Record<string, any>)[type];
          const property = readSchema(recipe.generator).properties?.[
            preference.option
          ];
          expect(
            property,
            `${key} prefers ${preference.side}.${preference.option}, absent from ${recipe.generator}'s schema`,
          ).toBeDefined();
          expect(
            property.enum,
            `${key} prefers ${preference.option}='${preference.value}', not in its enum`,
          ).toContain(preference.value);
        }
      }
    });

    it('should not prefer a value a constraint forbids', () => {
      // A preference that contradicts the rule it sits beside would auto-fix a
      // graph straight into a validation error.
      for (const [key, preferences] of Object.entries(
        CONNECTION_PREFERENCES as Record<
          string,
          readonly { side: string; option: string; value: string }[]
        >,
      )) {
        const constraints =
          (
            CONNECTION_CONSTRAINTS as Record<
              string,
              readonly {
                side: string;
                option: string;
                equals?: string;
                notEquals?: string;
              }[]
            >
          )[key] ?? [];
        for (const preference of preferences) {
          for (const constraint of constraints) {
            if (
              constraint.side !== preference.side ||
              constraint.option !== preference.option
            ) {
              continue;
            }
            if (constraint.equals !== undefined) {
              expect(preference.value).toBe(constraint.equals);
            }
            expect(preference.value).not.toBe(constraint.notEquals);
          }
        }
      }
    });

    it('should only order supported connections', () => {
      const unknown = [
        ...Object.keys(CONNECTION_ORDERING),
        ...Object.values(
          CONNECTION_ORDERING as Record<string, { after: readonly string[] }>,
        ).flatMap(({ after }) => after),
      ].filter((key) => !connectionKeys.includes(key));
      expect(unknown).toEqual([]);
    });

    it('should not order a connection after itself', () => {
      for (const [key, { after }] of Object.entries(
        CONNECTION_ORDERING as Record<string, { after: readonly string[] }>,
      )) {
        expect(after, `${key} cannot depend on itself`).not.toContain(key);
      }
    });

    it('should only disallow self-connection for supported connections', () => {
      const unknown = (SELF_CONNECTION_DISALLOWED as readonly string[]).filter(
        (key) => !connectionKeys.includes(key),
      );
      expect(unknown).toEqual([]);
    });

    it('should only disallow self-connection where both ends are the same type', () => {
      for (const key of SELF_CONNECTION_DISALLOWED) {
        const [source, target] = key.split(' -> ');
        expect(
          source,
          `${key} cannot connect to itself regardless — the ends differ`,
        ).toEqual(target);
      }
    });

    it('should constrain options the constrained end actually has', () => {
      for (const [key, constraints] of Object.entries(
        CONNECTION_CONSTRAINTS as Record<
          string,
          readonly {
            side: 'source' | 'target';
            option: string;
            equals?: string;
            notEquals?: string;
          }[]
        >,
      )) {
        const [source, target] = key.split(' -> ');
        for (const constraint of constraints) {
          const type = constraint.side === 'source' ? source : target;
          const recipe = (SCAFFOLD_RECIPES as Record<string, any>)[type];
          const schema = readSchema(recipe.generator);
          const property = schema.properties?.[constraint.option];
          expect(
            property,
            `${key} constrains ${constraint.side}.${constraint.option}, absent from ${recipe.generator}'s schema`,
          ).toBeDefined();

          // A constrained value must be one the option can hold, or the
          // constraint could never be satisfied (or never violated).
          const value = constraint.equals ?? constraint.notEquals;
          if (property.enum && value !== undefined) {
            expect(
              property.enum,
              `${key} constrains ${constraint.option} to '${value}', not in its enum`,
            ).toContain(value);
          }
        }
      }
    });

    it('should state exactly one of equals or notEquals per constraint', () => {
      for (const [key, constraints] of Object.entries(
        CONNECTION_CONSTRAINTS as Record<
          string,
          readonly { equals?: string; notEquals?: string; reason: string }[]
        >,
      )) {
        for (const constraint of constraints) {
          const stated = [constraint.equals, constraint.notEquals].filter(
            (value) => value !== undefined,
          );
          expect(stated, `${key} has an ambiguous constraint`).toHaveLength(1);
          expect(constraint.reason.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
