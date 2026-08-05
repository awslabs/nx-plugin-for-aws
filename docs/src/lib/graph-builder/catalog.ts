/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  buildScaffoldRecipes,
  CONNECTION_CONSTRAINTS,
  CONNECTION_PREFERENCES,
  type ConnectionConstraint,
  type ConnectionPreference,
  type GeneratorSchema,
  type SchemaResolver,
  SELF_CONNECTION_DISALLOWED,
  schemaPathOf,
} from '../../../../packages/nx-plugin/src/connection/scaffold-catalog';
import { SUPPORTED_CONNECTIONS } from '../../../../packages/nx-plugin/src/connection/supported-connections';

/**
 * The graph builder's catalogue of node types and edges, derived at build time
 * from the plugin's own metadata: `SUPPORTED_CONNECTIONS` for the edges,
 * `SCAFFOLD_RECIPES` for how to scaffold each end, and each generator's
 * `schema.json` for the properties a node exposes.
 *
 * Nothing here is hand-listed, so a generator or connection added to the plugin
 * appears in the builder on the next docs build.
 */

/** A property of a node, taken from its generator's JSON schema. */
export interface NodeProperty {
  readonly name: string;
  readonly type: 'string' | 'boolean';
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly default?: string | boolean;
  readonly required: boolean;
  /** Whether the generator marks this as an important option. */
  readonly important: boolean;
}

/** A node type the user can drag onto the canvas. */
export interface NodeType {
  /** The connection endpoint type, e.g. `ts#trpc-api`. */
  readonly id: string;
  readonly label: string;
  /** The generator run to scaffold it. */
  readonly generator: string;
  /** Options pinning the generator to this endpoint type, e.g. `framework`. */
  readonly variantOptions: Readonly<Record<string, string>>;
  readonly kind: 'project' | 'component';
  /** Which end(s) of a supported connection this type can occupy. */
  readonly roles: readonly ('source' | 'target')[];
  readonly properties: readonly NodeProperty[];
  /** The name option the user fills in — `name` for most, absent when fixed. */
  readonly nameOption: string;
  /** The host project generator for component nodes. */
  readonly host?: {
    readonly generator: string;
    readonly options: Readonly<Record<string, string>>;
    readonly properties: readonly NodeProperty[];
    readonly snakeCaseName: boolean;
  };
  /** Language the node belongs to, for grouping in the palette. */
  readonly language: 'ts' | 'py' | 'agnostic';
  /** Palette category, derived from the generator's docs sidebar grouping. */
  readonly category: string;
  /** The logo to render, matched to an asset in the docs site. */
  readonly logo: string;
  /** A small overlay badge, distinguishing e.g. a TS agent from a Python one. */
  readonly badge?: string;
}

/** A directed edge the connection generator supports. */
export interface EdgeType {
  readonly source: string;
  readonly target: string;
  /** `<source> -> <target>`, the plugin's own connection key. */
  readonly key: string;
  readonly constraints: readonly ConnectionConstraint[];
  /** Option values this connection prefers but does not require. */
  readonly preferences: readonly ConnectionPreference[];
  /** Whether both ends must be distinct projects. */
  readonly disallowSelf: boolean;
}

type RawSchema = GeneratorSchema;

/**
 * Every generator's schema, bundled at build time. The plugin reads these from
 * disk, which the browser cannot do, so the docs site supplies its own resolver
 * over the same files and shares the plugin's derivation.
 */
const SCHEMA_MODULES = import.meta.glob<{ default: RawSchema }>(
  '../../../../packages/nx-plugin/src/**/schema.json',
  { eager: true },
);

const schemaOf: SchemaResolver = (generatorId: string): RawSchema => {
  // `generators.json` records plugin-root relative paths ('./src/x/schema.json');
  // the glob keys are docs relative. Match on the full recorded path so
  // `ts/api/schema.json` cannot be confused with `smithy/ts/api/schema.json`.
  const suffix = schemaPathOf(generatorId).replace(/^\./, '');
  const found = Object.entries(SCHEMA_MODULES).find(([file]) =>
    file.endsWith(`packages/nx-plugin${suffix}`),
  );
  if (!found) {
    throw new Error(
      `Graph builder: no bundled schema for '${generatorId}' (${suffix})`,
    );
  }
  return found[1].default;
};

/** The recipes, resolved against the bundled schemas. */
const SCAFFOLD_RECIPES = buildScaffoldRecipes(schemaOf);

/**
 * Options every generator takes that the builder drives itself, and which the
 * user should not be asked about: the name (prompted separately, per node), the
 * install batching flag (the emitted script defers installs), and the directory
 * options (left at their defaults so the emitted commands stay short).
 */
const HIDDEN_OPTIONS = new Set([
  'name',
  'project',
  'preferInstallDependencies',
  'directory',
  'subDirectory',
  'moduleName',
  'tableName',
  'databaseName',
  'databaseUser',
]);

/**
 * Turn a generator's JSON schema into the properties the builder exposes.
 * Options the builder drives itself are dropped, as are the variant options
 * pinning the generator to this node type — the user picked those by choosing
 * the node.
 */
const toProperties = (
  schema: RawSchema,
  variantOptions: Readonly<Record<string, string>>,
): NodeProperty[] => {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {})
    .filter(
      ([name, prop]) =>
        !HIDDEN_OPTIONS.has(name) &&
        !(name in variantOptions) &&
        (prop.type === 'string' || prop.type === 'boolean'),
    )
    .map(([name, prop]) => ({
      name,
      type: prop.type,
      ...(prop.description ? { description: prop.description } : {}),
      ...(prop.enum ? { enum: prop.enum as string[] } : {}),
      ...(prop.default !== undefined ? { default: prop.default } : {}),
      required: required.has(name),
      important: prop['x-priority'] === 'important',
    }));
};

/**
 * The palette grouping and artwork for each endpoint type. Only presentation
 * lives here — a type absent from this map still appears in the palette, under
 * its language with a generic logo, so a new endpoint type is never hidden by a
 * missing entry.
 */
/**
 * The artwork and palette grouping for each endpoint type — genuinely editorial
 * choices the generator metadata cannot supply (nothing in `ts#rdb`'s schema says
 * "Aurora", and the categories mirror the docs sidebar's own grouping).
 *
 * Language badges are *not* listed: a `ts#` type badges TypeScript and a `py#`
 * one Python, so those are derived. A type missing here still appears in the
 * palette, under "Other" with a generic mark.
 */
const PRESENTATION: Record<string, { category: string; logo: string }> = {
  'ts#trpc-api': { category: 'API', logo: 'trpc' },
  'ts#smithy-api': { category: 'API', logo: 'smithy' },
  'py#fast-api': { category: 'API', logo: 'fastapi' },
  'ts#react-website': { category: 'Frontend', logo: 'react' },
  'ts#agent': { category: 'Agentic', logo: 'strands' },
  'py#agent': { category: 'Agentic', logo: 'strands' },
  'ts#mcp-server': { category: 'Agentic', logo: 'mcp' },
  'py#mcp-server': { category: 'Agentic', logo: 'mcp' },
  'agentcore-gateway': { category: 'Agentic', logo: 'agentcore' },
  'ts#rdb': { category: 'Database', logo: 'aurora' },
  'py#rdb': { category: 'Database', logo: 'aurora' },
  'ts#dynamodb': { category: 'Database', logo: 'dynamodb' },
  'py#dynamodb': { category: 'Database', logo: 'dynamodb' },
};

/**
 * The language mark overlaid on a node's logo. Only where the logo alone is
 * ambiguous — a shared mark like Strands or DynamoDB is used by both languages,
 * whereas tRPC or FastAPI already implies one.
 */
const badgeFor = (
  id: string,
  logo: string,
): 'typescript' | 'python' | undefined => {
  const shared = Object.entries(PRESENTATION).filter(
    ([, presentation]) => presentation.logo === logo,
  );
  if (shared.length < 2) return undefined;
  if (id.startsWith('ts#')) return 'typescript';
  if (id.startsWith('py#')) return 'python';
  return undefined;
};

const languageOf = (id: string): NodeType['language'] =>
  id.startsWith('ts#') ? 'ts' : id.startsWith('py#') ? 'py' : 'agnostic';

/** Every endpoint type appearing at either end of a supported connection. */
const endpointTypes = (): string[] => {
  const seen = new Set<string>();
  for (const { source, target } of SUPPORTED_CONNECTIONS) {
    seen.add(source);
    seen.add(target);
  }
  return [...seen].sort();
};

const rolesOf = (id: string): ('source' | 'target')[] => {
  const roles: ('source' | 'target')[] = [];
  if (SUPPORTED_CONNECTIONS.some((c) => c.source === id)) roles.push('source');
  if (SUPPORTED_CONNECTIONS.some((c) => c.target === id)) roles.push('target');
  return roles;
};

/** The node types available in the palette. */
export const NODE_TYPES: readonly NodeType[] = endpointTypes().map((id) => {
  const recipe = (SCAFFOLD_RECIPES as Record<string, any>)[id];
  if (!recipe) {
    throw new Error(
      `Graph builder: '${id}' takes part in a supported connection but has no SCAFFOLD_RECIPES entry`,
    );
  }
  const variantOptions = recipe.options ?? {};
  const schema = schemaOf(recipe.generator);
  const presentation = PRESENTATION[id];

  return {
    id,
    label: recipe.label,
    generator: recipe.generator,
    variantOptions,
    kind: recipe.kind,
    roles: rolesOf(id),
    properties: toProperties(schema, variantOptions),
    nameOption: recipe.kind === 'component' ? 'name' : 'name',
    ...(recipe.host
      ? {
          host: {
            generator: recipe.host.generator,
            options: recipe.host.options ?? {},
            properties: toProperties(
              schemaOf(recipe.host.generator),
              recipe.host.options ?? {},
            ),
            snakeCaseName: recipe.host.snakeCaseName ?? false,
          },
        }
      : {}),
    language: languageOf(id),
    category: presentation?.category ?? 'Other',
    logo: presentation?.logo ?? 'typescript',
    ...(() => {
      const badge = presentation ? badgeFor(id, presentation.logo) : undefined;
      return badge ? { badge } : {};
    })(),
  };
});

/** The edges the connection generator supports. */
export const EDGE_TYPES: readonly EdgeType[] = SUPPORTED_CONNECTIONS.map(
  ({ source, target }) => {
    const key = `${source} -> ${target}`;
    return {
      source,
      target,
      key,
      constraints:
        (CONNECTION_CONSTRAINTS as Record<string, ConnectionConstraint[]>)[
          key
        ] ?? [],
      preferences:
        (CONNECTION_PREFERENCES as Record<string, ConnectionPreference[]>)[
          key
        ] ?? [],
      disallowSelf: (SELF_CONNECTION_DISALLOWED as readonly string[]).includes(
        key,
      ),
    };
  },
);

/**
 * The name given to the infrastructure project the emitted script appends. Every
 * generated project vends constructs for one deployable app to instantiate, so
 * the graph always gets one, named to match the plugin's own convention.
 */
export const INFRA_PROJECT_NAME = 'infra';

/** Palette categories, ordered to match the docs sidebar's generator grouping. */
export const CATEGORY_ORDER = [
  'Frontend',
  'API',
  'Agentic',
  'Database',
  'Other',
] as const;

export const nodeType = (id: string): NodeType => {
  const found = NODE_TYPES.find((t) => t.id === id);
  if (!found) throw new Error(`Graph builder: unknown node type '${id}'`);
  return found;
};

/** Whether an edge from one node type to another is supported. */
export const findEdgeType = (
  source: string,
  target: string,
): EdgeType | undefined =>
  EDGE_TYPES.find((e) => e.source === source && e.target === target);

/** The node types a given source type can connect to. */
export const targetsFor = (source: string): string[] => [
  ...new Set(
    EDGE_TYPES.filter((e) => e.source === source).map((e) => e.target),
  ),
];

/** The node types that can connect to a given target type. */
export const sourcesFor = (target: string): string[] => [
  ...new Set(
    EDGE_TYPES.filter((e) => e.target === target).map((e) => e.source),
  ),
];
