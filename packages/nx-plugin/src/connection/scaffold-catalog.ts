/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import GeneratorsJson from '../../generators.json' with { type: 'json' };
import {
  type ConnectionKey,
  SUPPORTED_CONNECTIONS,
  type SUPPORTED_PROJECT_TYPES,
} from './supported-connections';

/**
 * How to scaffold each end of a connection, derived from the plugin's own
 * metadata rather than hand-listed.
 *
 * Every connection endpoint type is also a generator id, which is what makes the
 * derivation possible:
 *
 * - **kind** — a generator whose schema `required`s a `project` adds a component
 *   to an existing project; anything else creates a project of its own.
 * - **host** — a component lands in a project made by its language's base
 *   generator (`ts#project` / `py#project`).
 * - **generator + options** — a type whose own generator is `hidden` is reached
 *   through the public wrapper that selects it, found by matching the wrapper's
 *   enum values against the type's name (`ts#trpc-api` ← `ts#api
 *   --framework=trpc`). A visible generator is run directly.
 *
 * - **label** — the generator schema's own `x-label`.
 *
 * The result is that adding a generator and a connection for it needs no edit
 * here at all. The one thing still declared below is the option constraints,
 * which live as imperative guards inside each connection generator and so cannot
 * be read from metadata.
 */

/**
 * Every type that can sit at either end of a connection: the project-level
 * types resolved by introspection, plus the component generator ids recorded in
 * component metadata.
 */
export type ConnectionEndpointType =
  | (typeof SUPPORTED_PROJECT_TYPES)[number]
  | (typeof SUPPORTED_CONNECTIONS)[number]['source']
  | (typeof SUPPORTED_CONNECTIONS)[number]['target'];

/**
 * Whether scaffolding an endpoint creates a project of its own, or adds a
 * component to a project that must already exist.
 */
export type ScaffoldKind = 'project' | 'component';

/** How to scaffold one end of a connection from the CLI. */
export interface ScaffoldRecipe {
  /** Human-readable name for this endpoint type. */
  readonly label: string;
  /** The generator id in `generators.json` that produces this endpoint. */
  readonly generator: string;
  /**
   * Options that select this endpoint type from its generator, for generators
   * producing more than one type (e.g. `framework`).
   */
  readonly options?: Readonly<Record<string, string>>;
  /** Whether the generator creates a project or adds a component to one. */
  readonly kind: ScaffoldKind;
  /**
   * The generator producing a project able to host this component, for
   * `component` recipes. Components are added to an existing project, so one
   * must be scaffolded first.
   */
  readonly host?: {
    readonly generator: string;
    readonly options?: Readonly<Record<string, string>>;
    /**
     * Whether the host project's name is referenced in snake_case. Python
     * project names are snake_cased when qualified, TypeScript ones are not.
     */
    readonly snakeCaseName?: boolean;
  };
}

type GeneratorEntry = { schema: string; hidden?: boolean };
/** The subset of JSON Schema the catalogue and the docs builder read. */
export type GeneratorSchema = {
  /**
   * Short display name for the thing this generator produces, used by the docs
   * graph builder's palette. Set it on any generator that can take part in a
   * connection.
   */
  'x-label'?: string;
  properties?: Record<
    string,
    {
      type?: string;
      description?: string;
      enum?: string[];
      default?: unknown;
      'x-priority'?: string;
    }
  >;
  required?: string[];
};

type Schema = GeneratorSchema;

const GENERATORS = GeneratorsJson.generators as Record<string, GeneratorEntry>;

/**
 * Resolves a generator's JSON schema by generator id.
 *
 * Injected rather than fixed because the two callers load files differently: the
 * plugin reads from disk (see `./schema-resolver`), while the docs site bundles
 * the schemas for the browser, where `node:fs` does not exist. Keeping this
 * module free of `node:fs` is what lets the browser import it at all.
 */
export type SchemaResolver = (generatorId: string) => Schema;

/** The path `generators.json` records for a generator, relative to the plugin root. */
export const schemaPathOf = (generatorId: string): string => {
  const entry = GENERATORS[generatorId];
  if (!entry) {
    throw new Error(
      `Scaffold catalog: '${generatorId}' is not in generators.json`,
    );
  }
  return entry.schema;
};

/** The language prefix of a generator id: `ts` for `ts#agent`, `` for `license`. */
const languageOf = (id: string): string =>
  id.includes('#') ? id.slice(0, id.indexOf('#')) : '';

/** Compare ids ignoring the separators that differ between wrapper and variant. */
const alike = (a: string, b: string): boolean =>
  a.replace(/[^a-z0-9]/gi, '').toLowerCase() ===
  b.replace(/[^a-z0-9]/gi, '').toLowerCase();

/**
 * The public generator and option value that select a hidden endpoint type.
 *
 * A wrapper like `ts#api` produces several endpoint types, choosing between them
 * with an enum option: `--framework=trpc` yields `ts#trpc-api`. The pairing is
 * found by looking for a same-language public generator with an enum value that
 * reconstructs the endpoint's own name.
 */
const findWrapper = (
  endpointType: string,
  schemaOf: SchemaResolver,
): { generator: string; options: Record<string, string> } | undefined => {
  const language = languageOf(endpointType);
  const name = endpointType.slice(endpointType.indexOf('#') + 1);

  for (const [generatorId, entry] of Object.entries(GENERATORS)) {
    if (entry.hidden) continue;
    if (languageOf(generatorId) !== language) continue;
    const wrapperName = generatorId.slice(generatorId.indexOf('#') + 1);

    for (const [option, property] of Object.entries(
      schemaOf(generatorId).properties ?? {},
    )) {
      for (const value of property.enum ?? []) {
        // Either the value names the variant outright (`react` for
        // `react-website`), or it qualifies the wrapper's own name
        // (`trpc` + `api` for `trpc-api`).
        if (alike(value, name) || alike(`${value}${wrapperName}`, name)) {
          return { generator: generatorId, options: { [option]: value } };
        }
      }
    }
  }
  return undefined;
};

/**
 * Derive the recipe for one endpoint type. Exported so a test can assert the
 * derivation against every type the plugin supports.
 */
export const deriveScaffoldRecipe = (
  endpointType: string,
  schemaOf: SchemaResolver,
): ScaffoldRecipe => {
  const own = GENERATORS[endpointType];
  if (!own) {
    throw new Error(
      `Scaffold catalog: connection endpoint '${endpointType}' is not a generator id`,
    );
  }

  // A hidden generator is an implementation detail reached through its public
  // wrapper, which is what a user would actually run.
  const wrapper = own.hidden ? findWrapper(endpointType, schemaOf) : undefined;
  if (own.hidden && !wrapper) {
    throw new Error(
      `Scaffold catalog: '${endpointType}' is hidden and no public generator selects it`,
    );
  }

  // A generator requiring a `project` adds a component to one; anything else
  // creates its own project.
  const kind: ScaffoldKind = (schemaOf(endpointType).required ?? []).includes(
    'project',
  )
    ? 'component'
    : 'project';

  const language = languageOf(endpointType);
  const hostGenerator = `${language}#project`;
  if (kind === 'component' && !GENERATORS[hostGenerator]) {
    throw new Error(
      `Scaffold catalog: '${endpointType}' is a component but '${hostGenerator}' does not exist to host it`,
    );
  }

  return {
    // `x-label` is the short noun a palette entry needs; `title` and
    // `description` are prose aimed at CLI prompts ("Create a relational database
    // project"). A generator without one falls back to its id, so a new endpoint
    // type still appears rather than being dropped.
    label: schemaOf(endpointType)['x-label'] ?? endpointType,
    generator: wrapper?.generator ?? endpointType,
    ...(wrapper ? { options: wrapper.options } : {}),
    kind,
    ...(kind === 'component'
      ? {
          host: {
            generator: hostGenerator,
            // Only options the host's schema actually requires, so a base
            // project generator gaining a required option is handled here.
            options: Object.fromEntries(
              (schemaOf(hostGenerator).required ?? [])
                .filter((option) => option !== 'name')
                .map((option) => {
                  const property = schemaOf(hostGenerator).properties?.[option];
                  const value = property?.default ?? property?.enum?.[0];
                  if (value === undefined) {
                    throw new Error(
                      `Scaffold catalog: '${hostGenerator}' requires '${option}' but its schema offers no value to use`,
                    );
                  }
                  return [option, String(value)];
                }),
            ),
            // Python project names are snake_cased when Nx qualifies them.
            snakeCaseName: language === 'py',
          },
        }
      : {}),
  };
};

/** Every endpoint type appearing at either end of a supported connection. */
export const CONNECTION_ENDPOINT_TYPES: readonly string[] = [
  ...new Set(
    SUPPORTED_CONNECTIONS.flatMap(({ source, target }) => [source, target]),
  ),
].sort();

/**
 * How to scaffold each connection endpoint type, derived from the generator
 * metadata. A connection added to `SUPPORTED_CONNECTIONS` appears here with no
 * edit to this file.
 */
export const buildScaffoldRecipes = (
  schemaOf: SchemaResolver,
): Readonly<Record<string, ScaffoldRecipe>> =>
  Object.fromEntries(
    CONNECTION_ENDPOINT_TYPES.map((type) => [
      type,
      deriveScaffoldRecipe(type, schemaOf),
    ]),
  );

/**
 * A requirement one end of a connection places on the other's options, mirroring
 * the guard the corresponding connection generator enforces.
 *
 * Declared rather than derived: each guard is an imperative `throw` inside its
 * connection generator, reachable only by running it. Recording them here lets a
 * caller choosing options up front check them first, and the paired test asserts
 * every entry names a real option with a value its enum allows.
 */
export interface ConnectionConstraint {
  /** Which end of the connection the constrained option belongs to. */
  readonly side: 'source' | 'target';
  /** The generator option carrying the constrained value. */
  readonly option: string;
  /** The only value accepted, if the option is pinned to one. */
  readonly equals?: string;
  /** A value rejected, for options accepting all but one. */
  readonly notEquals?: string;
  /** Why the constraint exists, phrased for the user choosing the option. */
  readonly reason: string;
}

/** Reusable constraint shapes, so the map below states each rule once. */
const AGENT_TO_AGENT: readonly ConnectionConstraint[] = [
  {
    side: 'target',
    option: 'protocol',
    equals: 'a2a',
    reason: 'Only an A2A agent can be connected to another agent as a tool.',
  },
  {
    side: 'target',
    option: 'auth',
    equals: 'iam',
    reason: 'A2A agent connections authenticate with IAM.',
  },
];

const WEBSITE_TO_AGENT: readonly ConnectionConstraint[] = [
  {
    side: 'target',
    option: 'protocol',
    notEquals: 'a2a',
    reason:
      'A2A agents are reached by other agents, not by a website. Use the http or ag-ui protocol.',
  },
];

const AGENT_TO_MCP: readonly ConnectionConstraint[] = [
  {
    side: 'target',
    option: 'auth',
    equals: 'iam',
    reason: 'An agent reaches an MCP server with IAM authentication.',
  },
];

const AGENT_TO_GATEWAY: readonly ConnectionConstraint[] = [
  {
    side: 'source',
    option: 'auth',
    equals: 'iam',
    reason: 'Only an IAM-authenticated agent can reach an IAM gateway.',
  },
  {
    side: 'target',
    option: 'auth',
    equals: 'iam',
    reason: 'Agent connections require the gateway to authenticate with IAM.',
  },
];

const GATEWAY_TO_MCP: readonly ConnectionConstraint[] = [
  {
    side: 'source',
    option: 'protocol',
    equals: 'mcp',
    reason:
      'MCP server targets can only be attached to an mcp-protocol gateway.',
  },
  {
    side: 'target',
    option: 'auth',
    equals: 'iam',
    reason: 'A gateway reaches an MCP server target with IAM authentication.',
  },
];

const GATEWAY_TO_AGENT: readonly ConnectionConstraint[] = [
  {
    side: 'source',
    option: 'protocol',
    equals: 'http',
    reason:
      'Agent runtime targets can only be attached to an http-protocol gateway.',
  },
  {
    side: 'target',
    option: 'auth',
    equals: 'iam',
    reason: 'The gateway signs requests to its agent targets with IAM.',
  },
];

/**
 * The option-level requirements each connection places on its endpoints.
 *
 * Only connections carrying a requirement appear. Keyed by `ConnectionKey`, so a
 * key that no longer names a supported connection is a compile error.
 */
export const CONNECTION_CONSTRAINTS = {
  'ts#react-website -> ts#agent': WEBSITE_TO_AGENT,
  'ts#react-website -> py#agent': WEBSITE_TO_AGENT,
  'ts#agent -> ts#agent': AGENT_TO_AGENT,
  'ts#agent -> py#agent': AGENT_TO_AGENT,
  'py#agent -> ts#agent': AGENT_TO_AGENT,
  'py#agent -> py#agent': AGENT_TO_AGENT,
  'ts#agent -> ts#mcp-server': AGENT_TO_MCP,
  'ts#agent -> py#mcp-server': AGENT_TO_MCP,
  'py#agent -> ts#mcp-server': AGENT_TO_MCP,
  'py#agent -> py#mcp-server': AGENT_TO_MCP,
  'ts#agent -> agentcore-gateway': AGENT_TO_GATEWAY,
  'py#agent -> agentcore-gateway': AGENT_TO_GATEWAY,
  'ts#react-website -> agentcore-gateway': [
    {
      side: 'target',
      option: 'protocol',
      equals: 'http',
      reason:
        'A website connects to an http-protocol gateway, which proxies requests to its agent targets.',
    },
  ],
  'agentcore-gateway -> ts#agent': [
    ...GATEWAY_TO_AGENT,
    {
      side: 'target',
      option: 'protocol',
      notEquals: 'http',
      reason:
        'A TypeScript http agent serves tRPC over WebSocket, which AgentCore Gateway does not support. Use the ag-ui or a2a protocol.',
    },
  ],
  'agentcore-gateway -> py#agent': GATEWAY_TO_AGENT,
  'agentcore-gateway -> ts#mcp-server': GATEWAY_TO_MCP,
  'agentcore-gateway -> py#mcp-server': GATEWAY_TO_MCP,
  'agentcore-gateway -> agentcore-gateway': [
    {
      side: 'source',
      option: 'protocol',
      equals: 'mcp',
      reason:
        'A gateway is aggregated into another as an MCP target, so both must be mcp-protocol gateways.',
    },
    {
      side: 'target',
      option: 'protocol',
      equals: 'mcp',
      reason:
        'A gateway is aggregated into another as an MCP target, so both must be mcp-protocol gateways.',
    },
    {
      side: 'target',
      option: 'auth',
      equals: 'iam',
      reason:
        'The source gateway signs its request with IAM, so the target gateway must accept IAM.',
    },
  ],
} as const satisfies Partial<
  Record<ConnectionKey, readonly ConnectionConstraint[]>
>;

/**
 * A generator run automatically after an endpoint is scaffolded, adding something
 * that endpoint should always have.
 *
 * A website is only useful with authentication in front of it, and `ts#website`
 * does not add it — `ts#website#auth` is a separate follow-up generator. Declared
 * here so the docs graph builder emits it without hardcoding the pairing.
 */
export interface FollowUpGenerator {
  /** The generator id to run after the endpoint's own. */
  readonly generator: string;
  /** Options to pass, beyond the `--project` naming the endpoint. */
  readonly options?: Readonly<Record<string, string>>;
  /** What it adds, for the emitted command's comment. */
  readonly adds: string;
}

/**
 * Generators run automatically after an endpoint type is scaffolded, keyed by
 * endpoint type.
 */
export const ENDPOINT_FOLLOW_UPS: Readonly<
  Record<string, readonly FollowUpGenerator[]>
> = {
  'ts#react-website': [
    {
      generator: 'ts#website#auth',
      // `cognitoDomain` is derived from the npm scope and project name when
      // omitted, so the command stays short.
      adds: 'Cognito authentication',
    },
  ],
};

/**
 * An option value a connection works best against, without requiring it.
 *
 * Distinct from `CONNECTION_CONSTRAINTS`: a constraint is a rule the connection
 * generator enforces, whereas a preference is the setting most users want. A
 * React website can call an `http` agent perfectly well, but AG-UI is the
 * protocol built for driving a frontend, so that is what a new connection picks.
 *
 * A caller applies these only where the user has not chosen the option, so a
 * preference never overrides a deliberate decision.
 */
export interface ConnectionPreference {
  readonly side: 'source' | 'target';
  readonly option: string;
  readonly value: string;
  /** Why this is the better default, phrased for the user. */
  readonly reason: string;
}

/** An agent target only attaches to an http gateway, an MCP server only to an mcp one. */
const GATEWAY_PREFERS_HTTP: ConnectionPreference = {
  side: 'source',
  option: 'protocol',
  value: 'http',
  reason:
    'Agent runtime targets are proxied by an http gateway, so attaching an agent selects that protocol.',
};

const GATEWAY_PREFERS_MCP: ConnectionPreference = {
  side: 'source',
  option: 'protocol',
  value: 'mcp',
  reason:
    'MCP server targets are aggregated by an mcp gateway, so attaching an MCP server selects that protocol.',
};

/**
 * Preferred option values per connection. Keyed by `ConnectionKey`, so a key that
 * no longer names a supported connection is a compile error.
 */
export const CONNECTION_PREFERENCES = {
  'ts#react-website -> ts#agent': [
    {
      side: 'target',
      option: 'protocol',
      value: 'ag-ui',
      reason:
        'AG-UI is the protocol built for driving a frontend, so a website connection selects it.',
    },
  ],
  'ts#react-website -> py#agent': [
    {
      side: 'target',
      option: 'protocol',
      value: 'ag-ui',
      reason:
        'AG-UI is the protocol built for driving a frontend, so a website connection selects it.',
    },
  ],
  // A gateway's protocol is decided by what it fronts, and the two are mutually
  // exclusive: agent runtime targets need an http gateway, MCP server targets an
  // mcp one. The gateway schema defaults to mcp, so only the agent side needs a
  // preference — but both are stated, so whichever target the user attaches
  // first settles the protocol.
  'agentcore-gateway -> ts#agent': [GATEWAY_PREFERS_HTTP],
  'agentcore-gateway -> py#agent': [GATEWAY_PREFERS_HTTP],
  'agentcore-gateway -> ts#mcp-server': [GATEWAY_PREFERS_MCP],
  'agentcore-gateway -> py#mcp-server': [GATEWAY_PREFERS_MCP],
  'ts#react-website -> agentcore-gateway': [
    {
      side: 'target',
      option: 'protocol',
      value: 'http',
      reason:
        'A website reaches a gateway’s agent targets over path-based http routing, so the gateway serves the http protocol.',
    },
  ],
} as const satisfies Partial<
  Record<ConnectionKey, readonly ConnectionPreference[]>
>;

/**
 * Connections that must be generated after another, because the generator reads
 * state the earlier one records.
 *
 * The website→gateway generator publishes a route per agent already attached to
 * the gateway, reading them from the gateway project's connection metadata. Run
 * before the gateway→agent connections, it finds none and wires up nothing.
 *
 * Keyed by `ConnectionKey`, so a key that no longer names a supported connection
 * is a compile error.
 */
export const CONNECTION_ORDERING = {
  'ts#react-website -> agentcore-gateway': {
    after: ['agentcore-gateway -> ts#agent', 'agentcore-gateway -> py#agent'],
    reason:
      'The website connection publishes a route per agent attached to the gateway, so the gateway’s agents must be attached first.',
  },
  'ts#react-website -> ts#trpc-api': {
    after: ['ts#trpc-api -> agentcore-harness'],
    reason:
      'The website connection generates a CopilotKit hook per Harness already connected to the api, so the api must be connected to its Harness(es) first.',
  },
} as const satisfies Partial<
  Record<
    ConnectionKey,
    { readonly after: readonly ConnectionKey[]; readonly reason: string }
  >
>;

/**
 * Connections whose source and target must be distinct projects, because the
 * connection generator refuses to wire a project to itself.
 */
export const SELF_CONNECTION_DISALLOWED = [
  'agentcore-gateway -> agentcore-gateway',
] as const satisfies readonly ConnectionKey[];
