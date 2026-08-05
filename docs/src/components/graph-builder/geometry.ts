/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Node dimensions are fixed so the SVG edge layer can compute anchor points
 * without measuring the DOM, keeping edges in step with nodes during a drag.
 */
export const NODE_WIDTH = 208;
export const NODE_HEIGHT = 76;

export const GRID = 24;

/**
 * Which way the graph flows. `horizontal` runs left to right with ports on the
 * side edges; `vertical` runs top to bottom with ports on the top and bottom.
 */
export type Orientation = 'horizontal' | 'vertical';

export interface Point {
  x: number;
  y: number;
}

/**
 * Half the port dot's overhang past the node edge, so an edge meets the centre
 * of the port it comes out of rather than the node's border. Mirrors the offset
 * the stylesheet positions the ports with.
 */
const PORT_OVERHANG = 1;

/** Where an edge leaves its source node: the centre of its output port. */
export const sourceAnchor = (
  node: Point,
  orientation: Orientation = 'horizontal',
): Point =>
  orientation === 'vertical'
    ? {
        x: node.x + NODE_WIDTH / 2,
        y: node.y + NODE_HEIGHT - PORT_OVERHANG,
      }
    : {
        x: node.x + NODE_WIDTH - PORT_OVERHANG,
        y: node.y + NODE_HEIGHT / 2,
      };

/** Where an edge meets its target node: the centre of its input port. */
export const targetAnchor = (
  node: Point,
  orientation: Orientation = 'horizontal',
): Point =>
  orientation === 'vertical'
    ? { x: node.x + NODE_WIDTH / 2, y: node.y + PORT_OVERHANG }
    : { x: node.x + PORT_OVERHANG, y: node.y + NODE_HEIGHT / 2 };

/**
 * A cubic bezier between two anchors, with control points along the flow axis so
 * edges leave and enter nodes square to the edge they attach to. The control
 * offset grows with the gap, so short hops stay tight and long ones sweep.
 */
export const edgePath = (
  from: Point,
  to: Point,
  orientation: Orientation = 'horizontal',
): string => {
  if (orientation === 'vertical') {
    const dy = Math.abs(to.y - from.y);
    const curve = Math.max(40, Math.min(dy * 0.6, 160));
    return `M ${from.x} ${from.y} C ${from.x} ${from.y + curve}, ${to.x} ${to.y - curve}, ${to.x} ${to.y}`;
  }
  const dx = Math.abs(to.x - from.x);
  const curve = Math.max(40, Math.min(dx * 0.6, 160));
  return `M ${from.x} ${from.y} C ${from.x + curve} ${from.y}, ${to.x - curve} ${to.y}, ${to.x} ${to.y}`;
};

/**
 * A self-edge, looping out of the node's output port and back into its input.
 * Bows out to the side of the flow axis so the loop stays clear of the node.
 */
export const loopPath = (
  node: Point,
  orientation: Orientation = 'horizontal',
): string => {
  const from = sourceAnchor(node, orientation);
  const to = targetAnchor(node, orientation);
  if (orientation === 'vertical') {
    return `M ${from.x} ${from.y} C ${from.x + 70} ${from.y + 90}, ${to.x + 70} ${to.y - 90}, ${to.x} ${to.y}`;
  }
  return `M ${from.x} ${from.y} C ${from.x + 90} ${from.y - 70}, ${to.x - 90} ${to.y - 70}, ${to.x} ${to.y}`;
};

/** Where a self-edge's delete affordance sits, clear of the node it loops around. */
export const loopMidpoint = (
  node: Point,
  orientation: Orientation = 'horizontal',
): Point =>
  orientation === 'vertical'
    ? { x: node.x + NODE_WIDTH + 34, y: node.y + NODE_HEIGHT / 2 }
    : { x: node.x + NODE_WIDTH / 2, y: node.y - 34 };

/** The midpoint of an edge path, where its delete affordance sits. */
export const edgeMidpoint = (from: Point, to: Point): Point => ({
  x: (from.x + to.x) / 2,
  y: (from.y + to.y) / 2,
});

export const snap = (value: number): number => Math.round(value / GRID) * GRID;

/**
 * Re-lay a set of node positions for a new orientation by transposing the flow
 * and cross axes.
 *
 * Positions are normalised to lanes first — nodes sharing a position along the
 * old flow axis form a lane, and lanes become steps along the new one. That way a
 * graph laid out by hand or by a preset comes back tidy on every swap, rather
 * than accumulating drift from repeatedly transposing raw pixel values.
 */
export const transposePositions = <
  T extends { id: string; x: number; y: number },
>(
  nodes: readonly T[],
  to: Orientation,
  /**
   * The canvas's visible width. Horizontal lanes are tightened, and wrapped if
   * even that will not fit, so a graph coming back from vertical lands in view
   * rather than off the right edge.
   */
  availableWidth?: number,
): { id: string; x: number; y: number }[] => {
  if (nodes.length === 0) return [];

  // Grouping tolerance: nodes within half a node's extent along the flow axis
  // count as the same lane, so a hand-nudged layout still groups sensibly.
  const from: Orientation = to === 'vertical' ? 'horizontal' : 'vertical';
  const flowOf = (node: T) => (from === 'horizontal' ? node.x : node.y);
  const crossOf = (node: T) => (from === 'horizontal' ? node.y : node.x);
  const tolerance = (from === 'horizontal' ? NODE_WIDTH : NODE_HEIGHT) / 2;

  // Lanes in flow order, each holding its nodes in cross order.
  const lanes: T[][] = [];
  for (const node of [...nodes].sort((a, b) => flowOf(a) - flowOf(b))) {
    const lane = lanes.at(-1);
    if (lane && Math.abs(flowOf(node) - flowOf(lane[0])) <= tolerance) {
      lane.push(node);
    } else {
      lanes.push([node]);
    }
  }
  for (const lane of lanes) lane.sort((a, b) => crossOf(a) - crossOf(b));

  const ORIGIN = 24;
  const crossStep = to === 'vertical' ? NODE_WIDTH + 48 : NODE_HEIGHT + 60;

  // Flowing left to right consumes width per lane, so the step is tightened to
  // fit the canvas — and where even the tightest step will not fit, lanes wrap
  // onto further rows. Flowing top to bottom the width is per *lane member*, and
  // graphs are rarely deep enough for height to bind, so it keeps its spacing.
  if (to === 'vertical') {
    const flowStep = NODE_HEIGHT + 60;
    return lanes.flatMap((lane, laneIndex) =>
      lane.map((node, indexInLane) => ({
        id: node.id,
        x: ORIGIN + indexInLane * crossStep,
        y: ORIGIN + laneIndex * flowStep,
      })),
    );
  }

  const { perRow, step } = fitLanes(lanes.length, availableWidth);
  // Rows the lanes themselves occupy, so a wrapped row clears the one above it.
  const deepestLane = Math.max(...lanes.map((lane) => lane.length));
  return lanes.flatMap((lane, laneIndex) =>
    lane.map((node, indexInLane) => ({
      id: node.id,
      x: ORIGIN + (laneIndex % perRow) * step,
      y:
        ORIGIN +
        (indexInLane + Math.floor(laneIndex / perRow) * deepestLane) *
          crossStep,
    })),
  );
};

/** Comfortable horizontal lane spacing, when the canvas is wide enough. */
const PREFERRED_LANE_STEP = NODE_WIDTH + 120;
/** The tightest lane spacing still leaving a visible gap between nodes. */
const MIN_LANE_STEP = NODE_WIDTH + 32;

/**
 * How many horizontal lanes fit side by side in the available width, and the
 * step to use. Mirrors how presets are laid out, so a transposed graph and a
 * freshly loaded preset agree.
 */
const fitLanes = (
  lanes: number,
  availableWidth?: number,
): { perRow: number; step: number } => {
  if (!availableWidth || lanes < 2) {
    return { perRow: Math.max(1, lanes), step: PREFERRED_LANE_STEP };
  }
  const usable = availableWidth - 24 - NODE_WIDTH - 24;
  const perRow = Math.max(
    1,
    Math.min(lanes, Math.floor(usable / MIN_LANE_STEP) + 1),
  );
  const step =
    perRow < 2
      ? PREFERRED_LANE_STEP
      : Math.max(
          MIN_LANE_STEP,
          Math.min(PREFERRED_LANE_STEP, Math.floor(usable / (perRow - 1))),
        );
  return { perRow, step };
};
