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

export interface Point {
  x: number;
  y: number;
}

/**
 * Half the port dot's overhang past the node edge, so an edge meets the centre
 * of the port it comes out of rather than the node's border. Mirrors the
 * `--gb-port-offset` the stylesheet positions the ports with.
 */
const PORT_OVERHANG = 1;

/** Where an edge leaves its source node: the centre of its output port. */
export const sourceAnchor = (node: Point): Point => ({
  x: node.x + NODE_WIDTH - PORT_OVERHANG,
  y: node.y + NODE_HEIGHT / 2,
});

/** Where an edge meets its target node: the centre of its input port. */
export const targetAnchor = (node: Point): Point => ({
  x: node.x + PORT_OVERHANG,
  y: node.y + NODE_HEIGHT / 2,
});

/**
 * A cubic bezier between two anchors, with horizontal control points so edges
 * leave and enter nodes flat. The control offset grows with the horizontal gap
 * so short hops stay tight and long ones sweep.
 */
export const edgePath = (from: Point, to: Point): string => {
  const dx = Math.abs(to.x - from.x);
  const curve = Math.max(40, Math.min(dx * 0.6, 160));
  return `M ${from.x} ${from.y} C ${from.x + curve} ${from.y}, ${to.x - curve} ${to.y}, ${to.x} ${to.y}`;
};

/**
 * A self-edge, drawn as a loop out of the right side and back into the left.
 * Used where a node connects to another of its own type placed at the same spot
 * is impossible — a loop keeps the edge visible rather than degenerate.
 */
export const loopPath = (node: Point): string => {
  const from = sourceAnchor(node);
  const to = targetAnchor(node);
  return `M ${from.x} ${from.y} C ${from.x + 90} ${from.y - 70}, ${to.x - 90} ${to.y - 70}, ${to.x} ${to.y}`;
};

/** The midpoint of an edge path, where its delete affordance sits. */
export const edgeMidpoint = (from: Point, to: Point): Point => ({
  x: (from.x + to.x) / 2,
  y: (from.y + to.y) / 2,
});

export const snap = (value: number): number => Math.round(value / GRID) * GRID;
