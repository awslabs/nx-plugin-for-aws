/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Orientation } from '../../components/graph-builder/geometry';
import { generatorProperties, NODE_TYPES, type NodeProperty } from './catalog';
import type { Graph, GraphNode } from './model';

/**
 * The AWS infrastructure view of a graph: what each project deploys, and how the
 * deployed resources connect.
 *
 * Each node type declares a *blueprint* — the resources its generator provisions,
 * laid out on a small grid, and the request path through them. A blueprint is
 * resolved against the option values in effect for a node, so a REST API shows
 * its WAF and an HTTP API doesn't, and an agent with `infra: none` shows a local
 * process rather than an AgentCore Runtime.
 *
 * Resolved blueprints become *boxes*: one per project, holding its own resources
 * and their interconnections. Connections between projects run box to box,
 * leaving the source box beside the resource that reaches out and arriving at the
 * one that receives traffic, so a website box can connect to an API box without
 * either box's internals being redrawn.
 */

type OptionValue = string | boolean;

/**
 * Option values something in a blueprint is present for: AND across keys, OR
 * within a key. Values are compared against the node's options, falling back to
 * each option's schema default.
 */
export type OptionPredicate = Readonly<
  Record<string, OptionValue | readonly OptionValue[]>
>;

/** One AWS resource inside a project's box. */
export interface BlueprintResource {
  readonly id: string;
  readonly label: string;
  /** A second line, e.g. the API flavour or what a bucket holds. */
  readonly detail?: string;
  /**
   * The artwork, named after a file in `public/icons/aws`. Omitted for something
   * that isn't an AWS resource, like a local process, which draws as a plain
   * tile.
   */
  readonly icon?: string;
  /** Position in the box's own grid. */
  readonly column: number;
  readonly row: number;
  /** The option values this resource is provisioned for. Always, if absent. */
  readonly when?: OptionPredicate;
}

/** A connection between two resources in the same box. */
export interface BlueprintLink {
  readonly from: string;
  readonly to: string;
}

export interface Blueprint {
  /**
   * What the box is called, for a generator with no node type of its own — a
   * Lambda function, a website's authentication. Node types take theirs from the
   * palette instead.
   */
  readonly label?: string;
  readonly resources: readonly BlueprintResource[];
  /**
   * The request path through the box, from what receives traffic to what serves
   * it. Resources the options leave out are skipped rather than breaking the
   * chain, so variants of the same step can sit at the same grid position and
   * only the provisioned one is joined up.
   */
  readonly path: readonly string[];
  /** Connections off the request path, such as a runtime reaching a model. */
  readonly links?: readonly BlueprintLink[];
  /**
   * Where a connection from another project arrives, and where one leaving for
   * another project departs. Default to the ends of the request path, which is
   * what all but a website wants — a browser calls an API from the page
   * CloudFront served, not from the bucket behind it.
   */
  readonly entry?: string;
  readonly exit?: string;
  /** What calls this project, drawn when nothing else in the diagram does. */
  readonly caller?: ExternalTile;
  /**
   * What this project hands off to, drawn when it connects to nothing else in the
   * diagram — a gateway with no targets of its own still fronts something.
   */
  readonly downstream?: ExternalTile;
}

/** Something outside the workspace, drawn as a tile at one end of the diagram. */
export interface ExternalTile {
  readonly label: string;
  readonly detail?: string;
  /**
   * The mark to draw. Defaults to the generic client one; `null` for something no
   * single service stands for, which draws as a plain tile.
   */
  readonly icon?: string | null;
}

/**
 * What each node type deploys.
 *
 * These mirror the architecture the generator guides describe, down to the
 * variants their option filters switch between — the diagram is the same content
 * as the prose, so the two must agree.
 */
const BLUEPRINTS: Readonly<Record<string, Blueprint>> = {
  'ts#react-website': {
    resources: [
      {
        id: 'waf',
        label: 'WAF',
        icon: 'waf',
        column: 0,
        row: 0,
        when: { infra: 'cloudfront-s3' },
      },
      {
        id: 'cloudfront',
        label: 'CloudFront',
        icon: 'cloudfront',
        column: 1,
        row: 0,
        when: { infra: 'cloudfront-s3' },
      },
      {
        id: 's3',
        label: 'S3',
        detail: 'Static assets',
        icon: 's3',
        column: 2,
        row: 0,
        when: { infra: 'cloudfront-s3' },
      },
    ],
    path: ['waf', 'cloudfront', 's3'],
    // The page the browser loaded from CloudFront is what calls an API, so
    // connections leave from there rather than from the bucket.
    exit: 'cloudfront',
    caller: { label: 'Web Browser' },
  },

  ...apiBlueprints('ts#trpc-api', 'py#fast-api'),
  // Smithy APIs are REST only, so the HTTP variant is dropped rather than being
  // left as a state the guide's filters can never select.
  ...apiBlueprints('ts#smithy-api'),

  ...agentBlueprints('ts#agent', 'py#agent'),
  ...mcpServerBlueprints('ts#mcp-server', 'py#mcp-server'),

  'agentcore-gateway': {
    resources: [
      {
        id: 'waf',
        label: 'WAF',
        icon: 'waf',
        column: 0,
        row: 0,
        when: { infra: 'agentcore' },
      },
      {
        id: 'gateway-mcp',
        label: 'AgentCore Gateway',
        detail: 'MCP',
        icon: 'bedrock-agentcore-gateway',
        column: 1,
        row: 0,
        when: { infra: 'agentcore', protocol: 'mcp' },
      },
      {
        id: 'gateway-http',
        label: 'AgentCore Gateway',
        detail: 'HTTP',
        icon: 'bedrock-agentcore-gateway',
        column: 1,
        row: 0,
        when: { infra: 'agentcore', protocol: 'http' },
      },
      {
        id: 'cognito',
        label: 'Cognito',
        detail: 'Token auth',
        icon: 'cognito',
        column: 1,
        row: 1,
        when: { infra: 'agentcore', auth: 'cognito' },
      },
      {
        id: 'iam',
        label: 'IAM',
        detail: 'SigV4 auth',
        icon: 'iam',
        column: 1,
        row: 1,
        when: { infra: 'agentcore', auth: 'iam' },
      },
    ],
    path: ['waf', 'gateway-mcp', 'gateway-http'],
    caller: { label: 'Client' },
    downstream: {
      label: 'Gateway targets',
      detail: 'MCP servers or agents',
      icon: 'bedrock-agentcore-runtime',
    },
    links: [
      { from: 'cognito', to: 'gateway-mcp' },
      { from: 'cognito', to: 'gateway-http' },
      { from: 'iam', to: 'gateway-mcp' },
      { from: 'iam', to: 'gateway-http' },
    ],
  },

  ...dynamodbBlueprints('ts#dynamodb', 'py#dynamodb'),
  ...rdbBlueprints('ts#rdb', 'py#rdb'),

  // Generators with no node type of their own: they add to a project rather than
  // taking part in a connection, so they are named here.
  ...lambdaFunctionBlueprints('ts#lambda-function', 'py#lambda-function'),

  'ts#website#auth': {
    label: 'Authentication',
    resources: [
      {
        id: 'user-pool',
        label: 'Cognito',
        detail: 'User pool',
        icon: 'cognito',
        column: 0,
        row: 0,
      },
      {
        id: 'identity-pool',
        label: 'Cognito',
        detail: 'Identity pool',
        icon: 'cognito',
        column: 1,
        row: 0,
      },
      {
        id: 'iam',
        label: 'IAM',
        detail: 'Scoped credentials',
        icon: 'iam',
        column: 2,
        row: 0,
      },
    ],
    path: ['user-pool', 'identity-pool', 'iam'],
    caller: { label: 'Web Browser' },
    // Whatever the signed-in user's credentials reach: no one service stands for
    // it, so the tile carries no mark.
    downstream: {
      label: 'Authenticated resources',
      detail: 'APIs, agents, …',
      icon: null,
    },
  },
};

/** The Lambda function blueprint: the function an event source invokes. */
function lambdaFunctionBlueprints(
  ...types: string[]
): Record<string, Blueprint> {
  const blueprint: Blueprint = {
    label: 'Lambda Function',
    resources: [
      {
        id: 'lambda',
        label: 'Lambda',
        icon: 'lambda',
        column: 0,
        row: 0,
        when: { infra: 'lambda' },
      },
      {
        id: 'local',
        label: 'Handler',
        detail: 'local only',
        column: 0,
        row: 0,
        when: { infra: 'none' },
      },
    ],
    path: ['lambda', 'local'],
    // The generator vends the function; the event source is wired up in your own
    // stack, so it stands outside the project.
    caller: { label: 'Event source', detail: 'SQS, EventBridge, …' },
  };
  return Object.fromEntries(types.map((type) => [type, blueprint]));
}

/** The API blueprint: a Lambda behind API Gateway, with a WAF on REST stages. */
function apiBlueprints(...types: string[]): Record<string, Blueprint> {
  const blueprint: Blueprint = {
    resources: [
      {
        id: 'waf',
        label: 'WAF',
        icon: 'waf',
        column: 0,
        row: 0,
        when: { infra: 'rest-lambda' },
      },
      {
        id: 'apigw-rest',
        label: 'API Gateway',
        detail: 'REST API',
        icon: 'api-gateway',
        column: 1,
        row: 0,
        when: { infra: 'rest-lambda' },
      },
      {
        id: 'apigw-http',
        label: 'API Gateway',
        detail: 'HTTP API',
        icon: 'api-gateway',
        column: 1,
        row: 0,
        when: { infra: 'http-lambda' },
      },
      {
        id: 'lambda',
        label: 'Lambda',
        detail: 'Router',
        icon: 'lambda',
        column: 2,
        row: 0,
        when: { infra: ['rest-lambda', 'http-lambda'] },
      },
      {
        id: 'local',
        label: 'API',
        detail: 'local process',
        column: 0,
        row: 0,
        when: { infra: 'none' },
      },
    ],
    path: ['waf', 'apigw-rest', 'apigw-http', 'lambda', 'local'],
    caller: { label: 'Client' },
  };
  return Object.fromEntries(types.map((type) => [type, blueprint]));
}

/** The agent blueprint: an AgentCore Runtime calling Bedrock for inference. */
function agentBlueprints(...types: string[]): Record<string, Blueprint> {
  const blueprint: Blueprint = {
    resources: [
      {
        id: 'ecr',
        label: 'ECR',
        detail: 'Container image',
        icon: 'ecr',
        column: 0,
        row: 1,
        when: { infra: 'agentcore-ecr' },
      },
      {
        id: 'runtime',
        label: 'AgentCore Runtime',
        detail: 'Strands agent',
        icon: 'bedrock-agentcore-runtime',
        column: 1,
        row: 0,
        when: { infra: ['agentcore', 'agentcore-ecr'] },
      },
      {
        id: 'local',
        label: 'Agent',
        detail: 'local process',
        column: 1,
        row: 0,
        when: { infra: 'none' },
      },
      {
        id: 'sessions',
        label: 'S3',
        detail: 'Session state',
        icon: 's3',
        column: 1,
        row: 1,
        when: { infra: ['agentcore', 'agentcore-ecr'], session: 's3' },
      },
      {
        id: 'bedrock',
        label: 'Bedrock',
        detail: 'Model inference',
        icon: 'bedrock',
        column: 2,
        row: 0,
      },
    ],
    path: ['runtime', 'local'],
    links: [
      { from: 'ecr', to: 'runtime' },
      { from: 'runtime', to: 'sessions' },
      { from: 'runtime', to: 'bedrock' },
      { from: 'local', to: 'bedrock' },
    ],
    caller: { label: 'Client' },
  };
  return Object.fromEntries(types.map((type) => [type, blueprint]));
}

/** The MCP server blueprint: tools served from an AgentCore Runtime. */
function mcpServerBlueprints(...types: string[]): Record<string, Blueprint> {
  const blueprint: Blueprint = {
    resources: [
      {
        id: 'ecr',
        label: 'ECR',
        detail: 'Container image',
        icon: 'ecr',
        column: 0,
        row: 1,
        when: { infra: 'agentcore-ecr' },
      },
      {
        id: 'runtime',
        label: 'AgentCore Runtime',
        detail: 'MCP server',
        icon: 'bedrock-agentcore-runtime',
        column: 1,
        row: 0,
        when: { infra: ['agentcore', 'agentcore-ecr'] },
      },
      {
        id: 'local',
        label: 'MCP Server',
        detail: 'local process',
        column: 1,
        row: 0,
        when: { infra: 'none' },
      },
    ],
    path: ['runtime', 'local'],
    links: [{ from: 'ecr', to: 'runtime' }],
    caller: { label: 'AI Assistant' },
  };
  return Object.fromEntries(types.map((type) => [type, blueprint]));
}

/** The DynamoDB blueprint: the table itself. */
function dynamodbBlueprints(...types: string[]): Record<string, Blueprint> {
  const blueprint: Blueprint = {
    resources: [
      {
        id: 'table',
        label: 'DynamoDB',
        detail: 'Table',
        icon: 'dynamodb',
        column: 0,
        row: 0,
        when: { infra: 'dynamodb' },
      },
      {
        id: 'local',
        label: 'DynamoDB Local',
        detail: 'local container',
        column: 0,
        row: 0,
        when: { infra: 'none' },
      },
    ],
    path: ['table', 'local'],
    caller: { label: 'Application' },
  };
  return Object.fromEntries(types.map((type) => [type, blueprint]));
}

/** The relational database blueprint: Aurora behind an RDS Proxy. */
function rdbBlueprints(...types: string[]): Record<string, Blueprint> {
  const blueprint: Blueprint = {
    resources: [
      {
        id: 'proxy',
        label: 'RDS Proxy',
        detail: 'IAM auth',
        icon: 'rds',
        column: 0,
        row: 0,
        when: { infra: 'aurora' },
      },
      {
        id: 'aurora-postgres',
        label: 'Aurora',
        detail: 'PostgreSQL',
        icon: 'aurora',
        column: 1,
        row: 0,
        when: { infra: 'aurora', engine: 'postgres' },
      },
      {
        id: 'aurora-mysql',
        label: 'Aurora',
        detail: 'MySQL',
        icon: 'aurora',
        column: 1,
        row: 0,
        when: { infra: 'aurora', engine: 'mysql' },
      },
      {
        id: 'secrets',
        label: 'Secrets Manager',
        detail: 'DB credentials',
        icon: 'secrets-manager',
        column: 2,
        row: 0,
        when: { infra: 'aurora' },
      },
      {
        id: 'migrations',
        label: 'Lambda',
        detail: 'Migrations',
        icon: 'lambda',
        column: 1,
        row: 1,
        when: { infra: 'aurora' },
      },
    ],
    path: ['proxy', 'aurora-postgres', 'aurora-mysql'],
    links: [
      { from: 'aurora-postgres', to: 'secrets' },
      { from: 'aurora-mysql', to: 'secrets' },
      { from: 'migrations', to: 'aurora-postgres' },
      { from: 'migrations', to: 'aurora-mysql' },
    ],
    caller: { label: 'Application', detail: 'Lambda, agent, …' },
  };
  return Object.fromEntries(types.map((type) => [type, blueprint]));
}

/** Whether a node type has an infrastructure blueprint. */
export const hasBlueprint = (type: string): boolean => type in BLUEPRINTS;

/* ---------- Sizing ---------- */

/** A resource tile, and the spacing between tiles inside a box. */
const RESOURCE_WIDTH = 104;
const RESOURCE_HEIGHT = 92;
const RESOURCE_GAP_X = 20;
const RESOURCE_GAP_Y = 16;
/** Room inside a box, with more at the top for its label. */
const BOX_PADDING = 12;
const BOX_HEADER = 32;
/** Space between boxes, and around the diagram. */
const BOX_GAP = 44;
const ORIGIN = 20;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A resource placed in its box, positioned relative to the box's top left. */
export interface PlacedResource extends Rect {
  readonly id: string;
  readonly label: string;
  readonly detail?: string;
  readonly icon?: string;
}

/** A connection between two resources in the same box, in box coordinates. */
export interface PlacedLink {
  readonly id: string;
  readonly from: Rect;
  readonly to: Rect;
}

/** One project's infrastructure, drawn as a labelled box of resources. */
export interface InfraBox extends Rect {
  readonly id: string;
  /** The graph node this box was built from, absent for the caller tile. */
  readonly nodeId?: string;
  readonly name: string;
  readonly typeLabel: string;
  /** The caller tile stands on its own, outside any project. */
  readonly bare?: boolean;
  readonly resources: readonly PlacedResource[];
  readonly links: readonly PlacedLink[];
}

/** Where a cross-project connection attaches: a resource, and the box holding it. */
export interface InfraAnchor {
  readonly boxId: string;
  readonly box: Rect;
  readonly resource: Rect;
}

/** A connection between two projects' infrastructure. */
export interface InfraConnection {
  readonly id: string;
  /** The graph edge this came from, absent for the caller's own connection. */
  readonly edgeId?: string;
  readonly from: InfraAnchor;
  readonly to: InfraAnchor;
}

export interface InfraLayout {
  readonly boxes: readonly InfraBox[];
  readonly connections: readonly InfraConnection[];
  readonly width: number;
  readonly height: number;
  /** AWS resources drawn, for the diagram's summary line. */
  readonly resourceCount: number;
  readonly connectionCount: number;
}

/**
 * What a box is drawn from: its name in the diagram, and the options whose
 * defaults decide what it holds.
 *
 * A node type in the palette carries both. A generator with no node type — a
 * Lambda function, a website's authentication — takes its label from its
 * blueprint and its options straight from its schema.
 */
const subjects = new Map<
  string,
  { label: string; properties: readonly NodeProperty[] }
>();
const subjectOf = (type: string) => {
  const cached = subjects.get(type);
  if (cached) return cached;
  const known = NODE_TYPES.find((entry) => entry.id === type);
  const subject = known
    ? { label: known.label, properties: known.properties }
    : {
        label: BLUEPRINTS[type]?.label ?? type,
        properties: generatorProperties(type),
      };
  subjects.set(type, subject);
  return subject;
};

/** Whether a node's options satisfy a predicate. */
const matches = (node: GraphNode, predicate?: OptionPredicate): boolean => {
  if (!predicate) return true;
  const { properties } = subjectOf(node.type);
  return Object.entries(predicate).every(([option, wanted]) => {
    const value =
      option in node.options
        ? node.options[option]
        : properties.find((property) => property.name === option)?.default;
    const allowed = Array.isArray(wanted) ? wanted : [wanted];
    return allowed.includes(value as OptionValue);
  });
};

/**
 * Group values into steps along an axis, returning each value's step index.
 * Positions come from a grid, so anything within a few pixels is one step.
 */
const rankAxis = (values: readonly number[]): Map<number, number> => {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const ranks = new Map<number, number>();
  let rank = -1;
  let previous: number | undefined;
  for (const value of sorted) {
    if (previous === undefined || value - previous > 8) rank += 1;
    ranks.set(value, rank);
    previous = value;
  }
  return ranks;
};

/** A box's cell in the diagram's grid, and how much room it needs in it. */
interface Cell {
  readonly column: number;
  readonly row: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Size the grid the boxes sit on: each column as wide as the widest box in it and
 * each row as tall as the tallest, so a project deploying five resources doesn't
 * crowd one deploying a single table.
 */
const gridOf = (cells: readonly Cell[]) => {
  const columns = Math.max(...cells.map((cell) => cell.column)) + 1;
  const rows = Math.max(...cells.map((cell) => cell.row)) + 1;
  const columnWidths = Array.from({ length: columns }, (_, column) =>
    Math.max(
      ...cells
        .filter((cell) => cell.column === column)
        .map((cell) => cell.width),
    ),
  );
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(
      ...cells.filter((cell) => cell.row === row).map((cell) => cell.height),
    ),
  );
  const offsets = (sizes: readonly number[]) =>
    sizes.map((_, index) =>
      sizes
        .slice(0, index)
        .reduce((total, size) => total + size + BOX_GAP, ORIGIN),
    );
  return {
    columns,
    rows,
    columnWidths,
    rowHeights,
    columnX: offsets(columnWidths),
    rowY: offsets(rowHeights),
  };
};

/** Map the grid positions in use onto consecutive ones, in order. */
const compact = (positions: readonly number[]): Map<number, number> =>
  new Map(
    [...new Set(positions)]
      .sort((a, b) => a - b)
      .map((position, index) => [position, index]),
  );

/**
 * The room a box's label needs, so a project called `inventory-server` isn't
 * clipped by a box holding one narrow resource. Estimated from the label's length
 * rather than measured — the stylesheet ellipsises anything left over, so being a
 * few pixels out costs a little slack rather than a broken layout.
 */
const headerWidth = (name: string, typeLabel: string): number =>
  BOX_PADDING * 2 + name.length * 8.8 + typeLabel.length * 7.6 + 14;

/** A box's resources and internal links, resolved against a node's options. */
const resolveBox = (node: GraphNode) => {
  const blueprint = BLUEPRINTS[node.type];
  const present = (blueprint?.resources ?? []).filter((resource) =>
    matches(node, resource.when),
  );

  // Closed up, so a resource the options left out doesn't leave a gutter where
  // its column or row was.
  const columns = compact(present.map((resource) => resource.column));
  const rows = compact(present.map((resource) => resource.row));

  const resources: PlacedResource[] = present.map((resource) => ({
    id: resource.id,
    label: resource.label,
    ...(resource.detail ? { detail: resource.detail } : {}),
    ...(resource.icon ? { icon: resource.icon } : {}),
    x:
      BOX_PADDING +
      (columns.get(resource.column) ?? 0) * (RESOURCE_WIDTH + RESOURCE_GAP_X),
    y:
      BOX_HEADER +
      (rows.get(resource.row) ?? 0) * (RESOURCE_HEIGHT + RESOURCE_GAP_Y),
    width: RESOURCE_WIDTH,
    height: RESOURCE_HEIGHT,
  }));

  // A project with `infra: none` provisions nothing, which reads better as a
  // stated absence than as an empty box.
  if (resources.length === 0) {
    resources.push({
      id: 'none',
      label: 'No infrastructure',
      x: BOX_PADDING,
      y: BOX_HEADER,
      width: RESOURCE_WIDTH,
      height: RESOURCE_HEIGHT,
    });
  }

  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  const links: PlacedLink[] = [];
  const link = (from: string, to: string) => {
    const source = byId.get(from);
    const target = byId.get(to);
    if (!source || !target) return;
    links.push({ id: `${from}-${to}`, from: source, to: target });
  };

  // The request path, closing over the steps this node's options left out.
  const onPath = (blueprint?.path ?? []).filter((id) => byId.has(id));
  for (let i = 1; i < onPath.length; i += 1) link(onPath[i - 1], onPath[i]);
  for (const extra of blueprint?.links ?? []) link(extra.from, extra.to);

  const width = Math.max(
    Math.max(...resources.map((resource) => resource.x + resource.width)) +
      BOX_PADDING,
    headerWidth(node.name, subjectOf(node.type).label),
  );
  const height =
    Math.max(...resources.map((resource) => resource.y + resource.height)) +
    BOX_PADDING;

  // Where connections from other projects attach. The path's ends are the
  // default; a blueprint naming a step the options left out falls back to them.
  const entry = byId.has(blueprint?.entry ?? '')
    ? blueprint!.entry!
    : onPath.at(0);
  const exit = byId.has(blueprint?.exit ?? '')
    ? blueprint!.exit!
    : onPath.at(-1);

  return {
    resources,
    links,
    width,
    height,
    entry: byId.get(entry ?? '') ?? resources[0],
    exit: byId.get(exit ?? '') ?? resources[0],
    caller: blueprint?.caller,
    downstream: blueprint?.downstream,
  };
};

export interface LayoutOptions {
  /**
   * The flow axis of the positions the graph's nodes carry, which is what says
   * which step along the flow — and which slot across it — each box takes.
   */
  readonly from?: Orientation;
  /**
   * Which way the boxes themselves flow. Defaults to down the diagram, since a
   * box of resources laid out left to right is far wider than a project node:
   * stacked, a workspace's infrastructure stays legible in a docs column, where
   * the same boxes side by side would have to be scaled past reading. A host with
   * room to spare — the homepage's showcase — asks for `horizontal` instead.
   */
  readonly flow?: Orientation;
}

/**
 * Build the AWS infrastructure layout for a graph.
 *
 * Boxes keep the graph's own arrangement, with columns and rows sized to the boxes
 * in them, so a project deploying five resources doesn't crowd one deploying a
 * single table.
 */
export const buildInfrastructureLayout = (
  graph: Graph,
  { from = 'horizontal', flow = 'vertical' }: LayoutOptions = {},
): InfraLayout => {
  if (graph.nodes.length === 0) {
    return {
      boxes: [],
      connections: [],
      width: ORIGIN * 2,
      height: ORIGIN * 2,
      resourceCount: 0,
      connectionCount: 0,
    };
  }

  // Each node's step along the graph's own flow, and its slot across it, become
  // the row and column of its box — transposed when the boxes flow the other way.
  const alongX = rankAxis(graph.nodes.map((node) => node.x));
  const alongY = rankAxis(graph.nodes.map((node) => node.y));
  const sideways = from === 'horizontal';
  const stepOf = (node: GraphNode) =>
    (sideways ? alongX.get(node.x) : alongY.get(node.y)) ?? 0;
  const slotOf = (node: GraphNode) =>
    (sideways ? alongY.get(node.y) : alongX.get(node.x)) ?? 0;
  const stacked = flow === 'vertical';

  const resolved = graph.nodes.map((node) => ({
    node,
    column: stacked ? slotOf(node) : stepOf(node),
    row: stacked ? stepOf(node) : slotOf(node),
    ...resolveBox(node),
  }));

  const { columns, rows, columnWidths, rowHeights, columnX, rowY } =
    gridOf(resolved);

  // Boxes with nothing pointing at them are what a caller reaches, and boxes
  // pointing at nothing are where the diagram hands off, so those tiles sit at
  // either end of the graph's own flow axis.
  const targeted = new Set(graph.edges.map((edge) => edge.target));
  const sourced = new Set(graph.edges.map((edge) => edge.source));
  const entryBoxes = resolved.filter((entry) => !targeted.has(entry.node.id));
  const exitBoxes = resolved.filter((entry) => !sourced.has(entry.node.id));
  const caller = bareTile(
    'caller',
    entryBoxes.map((entry) => entry.caller),
    'Client',
  );
  const downstream = bareTile(
    'downstream',
    exitBoxes.map((entry) => entry.downstream),
  );
  // Ahead of a stack of boxes the caller sits above them; beside a single row it
  // reads better in line with them, the way a guide's own diagram runs.
  const along: Orientation = stacked && rows > 1 ? 'vertical' : 'horizontal';
  const shift = caller
    ? along === 'vertical'
      ? { x: 0, y: caller.height + BOX_GAP }
      : { x: caller.width + BOX_GAP, y: 0 }
    : { x: 0, y: 0 };

  const boxes: InfraBox[] = resolved.map((entry) => ({
    id: entry.node.id,
    nodeId: entry.node.id,
    name: entry.node.name,
    typeLabel: subjectOf(entry.node.type).label,
    // Centred in its column and row, so boxes of different sizes line up on
    // their middles rather than their edges.
    x:
      shift.x +
      columnX[entry.column] +
      (columnWidths[entry.column] - entry.width) / 2,
    y: shift.y + rowY[entry.row] + (rowHeights[entry.row] - entry.height) / 2,
    width: entry.width,
    height: entry.height,
    resources: entry.resources,
    links: entry.links,
  }));

  const boxById = new Map(boxes.map((box) => [box.id, box]));
  const anchorOf = (boxId: string, resource: PlacedResource): InfraAnchor => {
    const box = boxById.get(boxId)!;
    return {
      boxId,
      box,
      resource: {
        x: box.x + resource.x,
        y: box.y + resource.y,
        width: resource.width,
        height: resource.height,
      },
    };
  };

  const resolvedById = new Map(
    resolved.map((entry) => [entry.node.id, entry] as const),
  );
  const connections: InfraConnection[] = [];
  for (const edge of graph.edges) {
    const source = resolvedById.get(edge.source);
    const target = resolvedById.get(edge.target);
    if (!source || !target || source === target) continue;
    connections.push({
      id: edge.id,
      edgeId: edge.id,
      from: anchorOf(source.node.id, source.exit),
      to: anchorOf(target.node.id, target.entry),
    });
  }

  /**
   * Put a bare tile at one end of the flow, centred on the boxes it connects to,
   * and join it to each of them.
   */
  const placeTile = (
    tile: InfraBox,
    attached: typeof resolved,
    end: 'start' | 'finish',
  ) => {
    const against = attached.map((entry) => boxById.get(entry.node.id)!);
    const middle =
      (Math.min(
        ...against.map((box) => (along === 'vertical' ? box.x : box.y)),
      ) +
        Math.max(
          ...against.map((box) =>
            along === 'vertical' ? box.x + box.width : box.y + box.height,
          ),
        )) /
      2;
    const after =
      Math.max(
        ...boxes.map((box) =>
          along === 'vertical' ? box.y + box.height : box.x + box.width,
        ),
      ) + BOX_GAP;
    const placed: InfraBox = {
      ...tile,
      x:
        along === 'vertical'
          ? middle - tile.width / 2
          : end === 'start'
            ? ORIGIN
            : after,
      y:
        along === 'vertical'
          ? end === 'start'
            ? ORIGIN
            : after
          : middle - tile.height / 2,
    };
    // In reading order: the caller ahead of the projects, the hand-off after them.
    if (end === 'start') boxes.unshift(placed);
    else boxes.push(placed);
    boxById.set(placed.id, placed);
    for (const entry of attached) {
      const box = anchorOf(
        entry.node.id,
        end === 'start' ? entry.entry : entry.exit,
      );
      const own = anchorOf(placed.id, placed.resources[0]);
      connections.push({
        id: `${tile.id}-${entry.node.id}`,
        from: end === 'start' ? own : box,
        to: end === 'start' ? box : own,
      });
    }
  };

  if (caller) placeTile(caller, entryBoxes, 'start');
  if (downstream) placeTile(downstream, exitBoxes, 'finish');

  return {
    boxes,
    connections,
    width: Math.max(...boxes.map((box) => box.x + box.width)) + ORIGIN,
    height: Math.max(...boxes.map((box) => box.y + box.height)) + ORIGIN,
    resourceCount: resolved.reduce(
      (total, entry) => total + entry.resources.length,
      0,
    ),
    connectionCount:
      connections.length +
      resolved.reduce((total, entry) => total + entry.links.length, 0),
  };
};

/**
 * A tile standing in for something outside the workspace at one end of the
 * diagram: whoever calls its entry points — a browser for a website, an AI
 * assistant for an MCP server — or whatever its last projects hand off to.
 *
 * One tile serves every box at that end, so it is only drawn where they all
 * declare one; where they declare different ones it falls back to the generic
 * label, and without a fallback it isn't drawn at all.
 */
const bareTile = (
  id: string,
  declared: readonly (ExternalTile | undefined)[],
  fallbackLabel?: string,
): InfraBox | undefined => {
  if (declared.length === 0) return undefined;
  if (declared.some((entry) => entry === undefined)) return undefined;
  const first = declared[0]!;
  const agreed = declared.every((entry) => entry!.label === first.label);
  if (!agreed && !fallbackLabel) return undefined;
  const tile = agreed ? first : { label: fallbackLabel! };

  return {
    id,
    name: tile.label,
    typeLabel: tile.label,
    bare: true,
    x: 0,
    y: 0,
    width: RESOURCE_WIDTH,
    height: RESOURCE_HEIGHT,
    resources: [
      {
        id,
        label: tile.label,
        ...(tile.detail ? { detail: tile.detail } : {}),
        ...(tile.icon === null ? {} : { icon: tile.icon ?? 'client' }),
        x: 0,
        y: 0,
        width: RESOURCE_WIDTH,
        height: RESOURCE_HEIGHT,
      },
    ],
    links: [],
  };
};

/* ---------- Diagrams declared outright ---------- */

/** One box in a declared diagram, holding tiles at its own grid positions. */
export interface DeclaredBox {
  readonly id: string;
  /** The box's title. A bare box has none: it is a tile standing on its own. */
  readonly name?: string;
  readonly typeLabel?: string;
  /** Something outside the workspace, drawn without a frame around it. */
  readonly bare?: boolean;
  readonly column: number;
  readonly row: number;
  readonly resources: readonly Omit<BlueprintResource, 'when'>[];
  readonly links?: readonly BlueprintLink[];
}

/**
 * A diagram declared outright, for a page describing a mechanism rather than a
 * project's own infrastructure — how runtime configuration reaches the things
 * that read it, say. Drawn with the same boxes, tiles and arrows as the rest, so
 * the docs' diagrams read as one set.
 */
export interface DeclaredDiagram {
  readonly boxes: readonly DeclaredBox[];
  /** Connections, as `boxId:resourceId` at each end. */
  readonly connections: readonly [string, string][];
}

/** Lay a declared diagram out on the same grid the infrastructure view uses. */
export const buildDeclaredLayout = (diagram: DeclaredDiagram): InfraLayout => {
  const sized = diagram.boxes.map((box) => {
    const resources: PlacedResource[] = box.resources.map((resource) => ({
      id: resource.id,
      label: resource.label,
      ...(resource.detail ? { detail: resource.detail } : {}),
      ...(resource.icon ? { icon: resource.icon } : {}),
      x: box.bare
        ? resource.column * (RESOURCE_WIDTH + RESOURCE_GAP_X)
        : BOX_PADDING + resource.column * (RESOURCE_WIDTH + RESOURCE_GAP_X),
      y: box.bare
        ? resource.row * (RESOURCE_HEIGHT + RESOURCE_GAP_Y)
        : BOX_HEADER + resource.row * (RESOURCE_HEIGHT + RESOURCE_GAP_Y),
      width: RESOURCE_WIDTH,
      height: RESOURCE_HEIGHT,
    }));
    const padding = box.bare ? 0 : BOX_PADDING;
    return {
      box,
      resources,
      column: box.column,
      row: box.row,
      width: Math.max(
        Math.max(...resources.map((resource) => resource.x + resource.width)) +
          padding,
        box.bare ? 0 : headerWidth(box.name ?? '', box.typeLabel ?? ''),
      ),
      height:
        Math.max(...resources.map((resource) => resource.y + resource.height)) +
        padding,
    };
  });

  const { columnWidths, rowHeights, columnX, rowY } = gridOf(sized);

  const boxes: InfraBox[] = sized.map((entry) => {
    const byId = new Map(
      entry.resources.map((resource) => [resource.id, resource]),
    );
    return {
      id: entry.box.id,
      name: entry.box.name ?? entry.resources[0].label,
      typeLabel: entry.box.typeLabel ?? '',
      ...(entry.box.bare ? { bare: true } : {}),
      x: columnX[entry.column] + (columnWidths[entry.column] - entry.width) / 2,
      y: rowY[entry.row] + (rowHeights[entry.row] - entry.height) / 2,
      width: entry.width,
      height: entry.height,
      resources: entry.resources,
      links: (entry.box.links ?? []).flatMap((link) => {
        const from = byId.get(link.from);
        const to = byId.get(link.to);
        return from && to ? [{ id: `${link.from}-${link.to}`, from, to }] : [];
      }),
    };
  });

  const boxById = new Map(boxes.map((box) => [box.id, box]));
  const anchorOf = (ref: string): InfraAnchor | undefined => {
    const [boxId, resourceId] = ref.split(':');
    const box = boxById.get(boxId);
    const resource = box?.resources.find((entry) => entry.id === resourceId);
    if (!box || !resource) return undefined;
    return {
      boxId,
      box,
      resource: {
        x: box.x + resource.x,
        y: box.y + resource.y,
        width: resource.width,
        height: resource.height,
      },
    };
  };

  const connections: InfraConnection[] = diagram.connections.flatMap(
    ([from, to]) => {
      const source = anchorOf(from);
      const target = anchorOf(to);
      return source && target
        ? [{ id: `${from}-${to}`, from: source, to: target }]
        : [];
    },
  );

  return {
    boxes,
    connections,
    width: Math.max(...boxes.map((box) => box.x + box.width)) + ORIGIN,
    height: Math.max(...boxes.map((box) => box.y + box.height)) + ORIGIN,
    resourceCount: boxes.reduce(
      (total, box) => total + box.resources.length,
      0,
    ),
    connectionCount:
      connections.length +
      boxes.reduce((total, box) => total + box.links.length, 0),
  };
};
