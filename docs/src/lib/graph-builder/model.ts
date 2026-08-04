/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { kebabCase } from '../../../../packages/nx-plugin/src/utils/names';
import {
  type EdgeType,
  findEdgeType,
  INFRA_PROJECT_NAME,
  type NodeType,
  nodeType,
} from './catalog';

/** A node the user has placed on the canvas. */
export interface GraphNode {
  readonly id: string;
  /** The catalogue node type id, e.g. `ts#trpc-api`. */
  readonly type: string;
  readonly name: string;
  /** Option values the user has set, keyed by option name. */
  readonly options: Record<string, string | boolean>;
  /** For component nodes, the name of the project hosting them. */
  readonly hostName?: string;
  readonly x: number;
  readonly y: number;
}

/** A connection the user has drawn. */
export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

export interface Graph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/** A problem with the graph, surfaced against the node or edge causing it. */
export interface Issue {
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly nodeId?: string;
  readonly edgeId?: string;
}

const isBlank = (value: string | undefined) => !value || value.trim() === '';

/** The option value in effect for a node, falling back to the schema default. */
export const effectiveOption = (
  node: GraphNode,
  type: NodeType,
  option: string,
): string | boolean | undefined => {
  if (option in node.options) return node.options[option];
  return type.properties.find((p) => p.name === option)?.default;
};

/**
 * Check an edge's constraints against the option values on its endpoints,
 * mirroring the guards the connection generators enforce so the user learns
 * about a conflict while drawing rather than when the generator throws.
 */
const checkConstraints = (
  edge: GraphEdge,
  edgeType: EdgeType,
  source: GraphNode,
  target: GraphNode,
): Issue[] => {
  const issues: Issue[] = [];
  for (const constraint of edgeType.constraints) {
    const node = constraint.side === 'source' ? source : target;
    const type = nodeType(node.type);
    const value = effectiveOption(node, type, constraint.option);
    if (value === undefined) continue;

    const violated =
      (constraint.equals !== undefined && value !== constraint.equals) ||
      (constraint.notEquals !== undefined && value === constraint.notEquals);

    if (violated) {
      const wanted =
        constraint.equals !== undefined
          ? `must be '${constraint.equals}'`
          : `cannot be '${constraint.notEquals}'`;
      issues.push({
        severity: 'error',
        edgeId: edge.id,
        nodeId: node.id,
        message: `${node.name}: ${constraint.option} ${wanted} for this connection — ${constraint.reason}`,
      });
    }
  }
  return issues;
};

/**
 * Validate a graph, returning every problem that would stop the emitted
 * commands from succeeding, plus warnings for a graph that would scaffold but
 * is probably not what the user meant.
 */
export const validate = (graph: Graph): Issue[] => {
  const issues: Issue[] = [];
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  // Names: required, and unique among projects and among a project's components.
  const projectNames = new Map<string, number>();
  for (const node of graph.nodes) {
    const type = nodeType(node.type);
    if (isBlank(node.name)) {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        message: `${type.label} needs a name.`,
      });
    }
    if (type.kind === 'component' && isBlank(node.hostName)) {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        message: `${node.name || type.label} needs a host project name.`,
      });
    }
    const projectName = type.kind === 'component' ? node.hostName : node.name;
    // The emitted script always appends an infrastructure project called
    // `infra`, so a project of the user's own claiming that name would collide.
    if (kebabCase(projectName ?? '') === INFRA_PROJECT_NAME) {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        message: `'${INFRA_PROJECT_NAME}' is reserved for the infrastructure project added for you. Pick a different name.`,
      });
    }
    if (!isBlank(projectName)) {
      projectNames.set(projectName!, (projectNames.get(projectName!) ?? 0) + 1);
    }
  }

  // A project name may repeat only where every use is a component host — those
  // components share one project, which is exactly how the generators work.
  for (const [name, count] of projectNames) {
    if (count < 2) continue;
    const users = graph.nodes.filter((n) => {
      const type = nodeType(n.type);
      return type.kind === 'component' ? n.hostName === name : n.name === name;
    });
    const projectNodes = users.filter(
      (n) => nodeType(n.type).kind === 'project',
    );
    if (projectNodes.length > 0 && users.length > projectNodes.length) {
      for (const node of users) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          message: `'${name}' is used both as a project name and as a component host. Pick a different name.`,
        });
      }
    } else if (projectNodes.length > 1) {
      for (const node of projectNodes) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          message: `Two projects are both named '${name}'. Project names must be unique.`,
        });
      }
    }
  }

  // Components sharing a host must not share a name — the connection generator
  // resolves a component by name within its project.
  const componentKeys = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    if (nodeType(node.type).kind !== 'component') continue;
    const key = `${node.hostName}\u0000${node.name}`;
    componentKeys.set(key, [...(componentKeys.get(key) ?? []), node]);
  }
  for (const nodes of componentKeys.values()) {
    if (nodes.length < 2) continue;
    for (const node of nodes) {
      issues.push({
        severity: 'error',
        nodeId: node.id,
        message: `'${node.hostName}' already has a component named '${node.name}'. Component names must be unique within a project.`,
      });
    }
  }

  // Components of the same host project must agree on that project's options,
  // since one project is scaffolded for all of them.
  const hostGroups = new Map<string, GraphNode[]>();
  for (const node of graph.nodes) {
    const type = nodeType(node.type);
    if (type.kind !== 'component' || isBlank(node.hostName)) continue;
    hostGroups.set(node.hostName!, [
      ...(hostGroups.get(node.hostName!) ?? []),
      node,
    ]);
  }
  for (const [host, nodes] of hostGroups) {
    const generators = new Set(
      nodes.map((n) => nodeType(n.type).host!.generator),
    );
    if (generators.size > 1) {
      for (const node of nodes) {
        issues.push({
          severity: 'error',
          nodeId: node.id,
          message: `Host project '${host}' would need to be both a ${[...generators].join(' and a ')} project. Use separate host projects.`,
        });
      }
    }
  }

  // Edges: supported, distinct where required, and constraint-satisfying.
  const seenEdges = new Set<string>();
  for (const edge of graph.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) continue;

    const edgeType = findEdgeType(source.type, target.type);
    if (!edgeType) {
      issues.push({
        severity: 'error',
        edgeId: edge.id,
        message: `The connection generator does not support ${nodeType(source.type).label} → ${nodeType(target.type).label}.`,
      });
      continue;
    }

    const pair = `${edge.source}\u0000${edge.target}`;
    if (seenEdges.has(pair)) {
      issues.push({
        severity: 'warning',
        edgeId: edge.id,
        message: `${source.name} is already connected to ${target.name}. The duplicate is ignored.`,
      });
    }
    seenEdges.add(pair);

    if (edgeType.disallowSelf && source.id === target.id) {
      issues.push({
        severity: 'error',
        edgeId: edge.id,
        message: `${source.name} cannot connect to itself.`,
      });
    }

    issues.push(...checkConstraints(edge, edgeType, source, target));
  }

  // A gateway fronting another gateway must not form a cycle, matching the
  // generator's own cycle check.
  issues.push(...findCycles(graph));

  return issues;
};

/**
 * Report gateway→gateway cycles. Only these edges are checked: elsewhere a cycle
 * is legitimate (two agents may each hold the other as an A2A tool).
 */
const findCycles = (graph: Graph): Issue[] => {
  const gatewayEdges = graph.edges.filter((edge) => {
    const source = graph.nodes.find((n) => n.id === edge.source);
    const target = graph.nodes.find((n) => n.id === edge.target);
    return (
      source?.type === 'agentcore-gateway' &&
      target?.type === 'agentcore-gateway'
    );
  });
  if (gatewayEdges.length === 0) return [];

  const adjacency = new Map<string, string[]>();
  for (const edge of gatewayEdges) {
    adjacency.set(edge.source, [
      ...(adjacency.get(edge.source) ?? []),
      edge.target,
    ]);
  }

  const issues: Issue[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();

  const walk = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (done.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (walk(next)) {
        const edge = gatewayEdges.find(
          (e) => e.source === id && e.target === next,
        );
        const source = graph.nodes.find((n) => n.id === id);
        issues.push({
          severity: 'error',
          ...(edge ? { edgeId: edge.id } : {}),
          message: `Gateway connections form a cycle through ${source?.name ?? id}. A gateway cannot reach itself.`,
        });
        visiting.delete(id);
        done.add(id);
        return false;
      }
    }
    visiting.delete(id);
    done.add(id);
    return false;
  };

  for (const id of adjacency.keys()) walk(id);
  return issues;
};

/** Whether a node can be dragged onto an edge as its source. */
export const canConnect = (source: GraphNode, target: GraphNode): boolean => {
  const edgeType = findEdgeType(source.type, target.type);
  if (!edgeType) return false;
  if (edgeType.disallowSelf && source.id === target.id) return false;
  return true;
};

/** The node types a node may connect out to, for highlighting valid drop targets. */
export const validTargetsFrom = (
  source: GraphNode,
  nodes: readonly GraphNode[],
): Set<string> => {
  const valid = new Set<string>();
  for (const node of nodes) {
    if (canConnect(source, node)) valid.add(node.id);
  }
  return valid;
};
