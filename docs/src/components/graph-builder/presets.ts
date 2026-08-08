/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { findEdgeType } from '../../lib/graph-builder/catalog';
import type { Graph } from '../../lib/graph-builder/model';
import { NODE_HEIGHT, NODE_WIDTH } from './geometry';

/**
 * Starting points a user can load instead of building from scratch.
 *
 * A preset lists node types and the pairs to connect, not coordinates or ids —
 * the layout is computed and the edges are resolved against the live catalogue,
 * so a preset naming a connection the plugin no longer supports drops that edge
 * rather than producing a graph that cannot be scaffolded.
 */
interface PresetNode {
  readonly type: string;
  readonly name: string;
  readonly hostName?: string;
  readonly options?: Record<string, string | boolean>;
  /** Column and row in the layout grid. */
  readonly column: number;
  readonly row: number;
}

export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly nodes: readonly PresetNode[];
  /** Connections as `[sourceName, targetName]` pairs. */
  readonly edges: readonly [string, string][];
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'trpc-web-app',
    label: 'tRPC web app',
    description: 'A React website calling a type-safe tRPC API.',
    nodes: [
      { type: 'ts#react-website', name: 'website', column: 0, row: 0 },
      { type: 'ts#trpc-api', name: 'my-api', column: 1, row: 0 },
      { type: 'ts#dynamodb', name: 'my-table', column: 2, row: 0 },
    ],
    edges: [
      ['website', 'my-api'],
      ['my-api', 'my-table'],
    ],
  },
  {
    id: 'fastapi-web-app',
    label: 'FastAPI web app',
    description: 'A React website calling a Python FastAPI backed by Aurora.',
    nodes: [
      { type: 'ts#react-website', name: 'website', column: 0, row: 0 },
      { type: 'py#fast-api', name: 'py-api', column: 1, row: 0 },
      { type: 'py#rdb', name: 'py-db', column: 2, row: 0 },
    ],
    edges: [
      ['website', 'py-api'],
      ['py-api', 'py-db'],
    ],
  },
  {
    id: 'agentic-app',
    label: 'Agentic app',
    description:
      'An AG-UI agent driving a React frontend, with an MCP server for tools.',
    nodes: [
      { type: 'ts#react-website', name: 'website', column: 0, row: 0 },
      {
        type: 'ts#agent',
        name: 'agent',
        hostName: 'agents',
        options: { protocol: 'ag-ui' },
        column: 1,
        row: 0,
      },
      {
        type: 'ts#mcp-server',
        name: 'tools',
        hostName: 'agents',
        column: 2,
        row: 0,
      },
      { type: 'ts#dynamodb', name: 'my-table', column: 2, row: 1 },
    ],
    edges: [
      ['website', 'agent'],
      ['agent', 'tools'],
      ['agent', 'my-table'],
    ],
  },
  {
    id: 'multi-agent',
    label: 'Multi-agent',
    description:
      'A TypeScript agent orchestrating a Python A2A agent, with tools behind a gateway.',
    nodes: [
      {
        type: 'ts#agent',
        name: 'orchestrator',
        hostName: 'agents',
        column: 0,
        row: 0,
      },
      {
        type: 'py#agent',
        name: 'researcher',
        hostName: 'py-agents',
        options: { protocol: 'a2a' },
        column: 1,
        row: 0,
      },
      { type: 'agentcore-gateway', name: 'gateway', column: 1, row: 1 },
      {
        type: 'py#mcp-server',
        name: 'tools',
        hostName: 'py-agents',
        column: 2,
        row: 1,
      },
    ],
    edges: [
      ['orchestrator', 'researcher'],
      ['orchestrator', 'gateway'],
      ['gateway', 'tools'],
    ],
  },
];

/** Comfortable spacing between columns, used when the canvas is wide enough. */
const PREFERRED_COLUMN_GAP = NODE_WIDTH + 120;
/** The tightest column spacing still leaving a visible gap between nodes. */
const MIN_COLUMN_GAP = NODE_WIDTH + 32;
const ROW_GAP = NODE_HEIGHT + 60;
const ORIGIN = { x: 24, y: 24 };
/** Room kept to the right of the last column so its node isn't flush to the edge. */
const RIGHT_PADDING = 24;

/**
 * How many of a preset's columns fit side by side in the available width, and the
 * spacing to use for them.
 *
 * Columns are spaced as generously as the width allows, tightening to
 * `MIN_COLUMN_GAP` before giving up. A canvas too narrow even for that (a node is
 * a fixed 208px, so three never fit a 400px canvas) takes fewer columns per row
 * and wraps the rest below, which keeps every node reachable without panning.
 */
const fitColumns = (
  columns: number,
  availableWidth?: number,
): { perRow: number; gap: number } => {
  if (!availableWidth || columns < 2) {
    return { perRow: columns, gap: PREFERRED_COLUMN_GAP };
  }
  const usable = availableWidth - ORIGIN.x - NODE_WIDTH - RIGHT_PADDING;
  // The most columns whose tightest spacing still fits.
  const perRow = Math.max(
    1,
    Math.min(columns, Math.floor(usable / MIN_COLUMN_GAP) + 1),
  );
  const gap =
    perRow < 2
      ? PREFERRED_COLUMN_GAP
      : Math.max(
          MIN_COLUMN_GAP,
          Math.min(PREFERRED_COLUMN_GAP, Math.floor(usable / (perRow - 1))),
        );
  return { perRow, gap };
};

/**
 * Turn a preset into a graph, laying nodes out on the column/row grid and
 * keeping only the edges the catalogue still supports.
 *
 * `availableWidth` is the canvas's visible width, so a preset lands fully in
 * view rather than with its rightmost column off the edge. Without it the
 * preferred spacing is used.
 */
export const buildPresetGraph = (
  preset: Preset,
  availableWidth?: number,
): Graph => {
  const columns = Math.max(...preset.nodes.map((node) => node.column)) + 1;
  const { perRow, gap } = fitColumns(columns, availableWidth);
  // Rows the preset itself declares, so wrapped columns start below them all
  // rather than colliding with an existing row.
  const declaredRows = Math.max(...preset.nodes.map((node) => node.row)) + 1;
  const nodes = preset.nodes.map((node, index) => ({
    id: `preset-${preset.id}-${index}`,
    type: node.type,
    name: node.name,
    options: node.options ?? {},
    ...(node.hostName ? { hostName: node.hostName } : {}),
    x: ORIGIN.x + (node.column % perRow) * gap,
    y:
      ORIGIN.y +
      (node.row + Math.floor(node.column / perRow) * declaredRows) * ROW_GAP,
  }));

  const byName = new Map(nodes.map((node) => [node.name, node]));
  const edges = preset.edges
    .map(([sourceName, targetName], index) => {
      const source = byName.get(sourceName);
      const target = byName.get(targetName);
      if (!source || !target) return undefined;
      if (!findEdgeType(source.type, target.type)) return undefined;
      return {
        id: `preset-${preset.id}-edge-${index}`,
        source: source.id,
        target: target.id,
      };
    })
    .filter((edge): edge is NonNullable<typeof edge> => edge !== undefined);

  return { nodes, edges };
};
