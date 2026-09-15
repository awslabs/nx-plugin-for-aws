/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  buildPresetGraph,
  PRESETS,
} from '../../components/graph-builder/presets';
import { NODE_TYPES } from './catalog';
import { buildInfrastructureLayout, hasBlueprint } from './infrastructure';
import type { Graph } from './model';

/** A one-project graph, as a generator guide's diagram draws. */
const single = (
  type: string,
  options: Record<string, string | boolean> = {},
): Graph => ({
  nodes: [{ id: 'n', type, name: 'my-project', options, x: 24, y: 24 }],
  edges: [],
});

const labelsOf = (graph: Graph): string[] =>
  buildInfrastructureLayout(graph)
    .boxes.flatMap((box) => box.resources)
    .map((resource) =>
      resource.detail
        ? `${resource.label} (${resource.detail})`
        : resource.label,
    );

describe('infrastructure view', () => {
  // Every type the palette offers is a project a diagram can be asked to draw, so
  // a new one without a blueprint would render an empty box.
  it.each(NODE_TYPES.map((type) => type.id))(
    'should have a blueprint for %s',
    (id) => {
      expect(hasBlueprint(id)).toBe(true);
    },
  );

  it.each(PRESETS.map((preset) => [preset.id, preset] as const))(
    'should lay out the %s preset',
    (_id, preset) => {
      const graph = buildPresetGraph(preset);
      const layout = buildInfrastructureLayout(graph);

      // One box per project, plus the caller tile standing in for whoever calls
      // the projects nothing else in the diagram does.
      expect(layout.boxes.filter((box) => !box.bare)).toHaveLength(
        preset.nodes.length,
      );
      expect(layout.boxes.filter((box) => box.bare)).toHaveLength(1);

      // Every project's connections are drawn, and every box holds something.
      expect(
        layout.connections.filter((connection) => connection.edgeId),
      ).toHaveLength(graph.edges.length);
      for (const box of layout.boxes) {
        expect(box.resources.length).toBeGreaterThan(0);
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
      }

      // Boxes are laid out on a grid sized to their contents, so none can overlap.
      for (const box of layout.boxes) {
        for (const other of layout.boxes) {
          if (box === other) continue;
          const overlaps =
            box.x < other.x + other.width &&
            other.x < box.x + box.width &&
            box.y < other.y + other.height &&
            other.y < box.y + box.height;
          expect(overlaps).toBe(false);
        }
      }

      // Everything fits inside the extent the diagram reports.
      for (const box of layout.boxes) {
        expect(box.x + box.width).toBeLessThanOrEqual(layout.width);
        expect(box.y + box.height).toBeLessThanOrEqual(layout.height);
      }
    },
  );

  // The variants a guide's option filters switch between, which the diagram has to
  // agree with — the WAF a REST stage brings is the clearest case.
  it('should draw a REST API behind a WAF', () => {
    expect(labelsOf(single('ts#trpc-api', { infra: 'rest-lambda' }))).toEqual([
      'Client',
      'WAF',
      'API Gateway (REST API)',
      'Lambda (Router)',
    ]);
  });

  it('should draw an HTTP API without a WAF', () => {
    expect(labelsOf(single('ts#trpc-api', { infra: 'http-lambda' }))).toEqual([
      'Client',
      'API Gateway (HTTP API)',
      'Lambda (Router)',
    ]);
  });

  it('should draw an agent as a local process when it deploys no infrastructure', () => {
    const layout = buildInfrastructureLayout(
      single('ts#agent', { infra: 'none' }),
    );
    const resources = layout.boxes.flatMap((box) => box.resources);
    expect(resources.map((resource) => resource.label)).toEqual([
      'Client',
      'Agent',
      'Bedrock',
    ]);
    // A local process is not an AWS resource, so it draws without an icon.
    expect(resources.find((resource) => resource.label === 'Agent')?.icon).toBe(
      undefined,
    );
  });

  it('should draw the container image registry only when the agent is built as one', () => {
    expect(labelsOf(single('ts#agent', { infra: 'agentcore' }))).not.toContain(
      'ECR (Container image)',
    );
    expect(labelsOf(single('ts#agent', { infra: 'agentcore-ecr' }))).toContain(
      'ECR (Container image)',
    );
  });

  it('should draw the database engine the project uses', () => {
    expect(labelsOf(single('ts#rdb', { engine: 'mysql' }))).toContain(
      'Aurora (MySQL)',
    );
    expect(labelsOf(single('ts#rdb', { engine: 'postgres' }))).toContain(
      'Aurora (PostgreSQL)',
    );
  });

  // A project can be generated without infrastructure, which reads better as a
  // stated absence than as an empty box.
  it('should say so when a project deploys nothing', () => {
    expect(labelsOf(single('ts#dynamodb', { infra: 'none' }))).toContain(
      'DynamoDB Local (local container)',
    );
    expect(labelsOf(single('ts#rdb', { infra: 'none' }))).toContain(
      'No infrastructure',
    );
  });

  // The website is the one project whose outbound connections leave from the
  // middle of its path: it is the page CloudFront served that calls an API.
  it('should connect a website to an API from its distribution', () => {
    const graph: Graph = {
      nodes: [
        {
          id: 'site',
          type: 'ts#react-website',
          name: 'website',
          options: {},
          x: 24,
          y: 24,
        },
        {
          id: 'api',
          type: 'ts#trpc-api',
          name: 'my-api',
          options: {},
          x: 322,
          y: 24,
        },
      ],
      edges: [{ id: 'e', source: 'site', target: 'api' }],
    };
    const layout = buildInfrastructureLayout(graph);
    const connection = layout.connections.find((entry) => entry.edgeId === 'e');
    const site = layout.boxes.find((box) => box.nodeId === 'site')!;
    const api = layout.boxes.find((box) => box.nodeId === 'api')!;
    const cloudfront = site.resources.find(
      (resource) => resource.id === 'cloudfront',
    )!;
    const waf = api.resources.find((resource) => resource.id === 'waf')!;

    expect(connection?.from.resource.x).toBe(site.x + cloudfront.x);
    expect(connection?.to.resource.x).toBe(api.x + waf.x);
  });

  // A gateway fronts something even when the diagram holds nothing for it to
  // front, so on its own guide it hands off to a tile standing in for its targets.
  it('should draw what a gateway hands off to when nothing else does', () => {
    expect(labelsOf(single('agentcore-gateway'))).toEqual([
      'Client',
      'WAF',
      'AgentCore Gateway (MCP)',
      'IAM (SigV4 auth)',
      'Gateway targets (MCP servers or agents)',
    ]);
  });

  it('should leave the hand-off out once the gateway has a target of its own', () => {
    const graph: Graph = {
      nodes: [
        {
          id: 'gateway',
          type: 'agentcore-gateway',
          name: 'gateway',
          options: {},
          x: 24,
          y: 24,
        },
        {
          id: 'tools',
          type: 'ts#mcp-server',
          name: 'tools',
          options: {},
          x: 322,
          y: 24,
        },
      ],
      edges: [{ id: 'e', source: 'gateway', target: 'tools' }],
    };
    expect(labelsOf(graph)).not.toContain(
      'Gateway targets (MCP servers or agents)',
    );
  });

  // Generators that add to a project rather than taking part in a connection have
  // no node type in the palette, so their guides draw straight from a blueprint.
  it('should draw a generator that has no node type of its own', () => {
    expect(labelsOf(single('ts#lambda-function'))).toEqual([
      'Event source (SQS, EventBridge, …)',
      'Lambda',
    ]);
    expect(labelsOf(single('ts#website#auth'))).toEqual([
      'Web Browser',
      'Cognito (User pool)',
      'Cognito (Identity pool)',
      'IAM (Scoped credentials)',
      'Authenticated resources (APIs, agents, …)',
    ]);
  });

  it('should take the box label from the blueprint where there is no node type', () => {
    const [box] = buildInfrastructureLayout(
      single('py#lambda-function'),
    ).boxes.filter((entry) => !entry.bare);
    expect(box.typeLabel).toBe('Lambda Function');
  });

  it('should have nothing to draw for an empty graph', () => {
    const layout = buildInfrastructureLayout({ nodes: [], edges: [] });
    expect(layout.boxes).toEqual([]);
    expect(layout.connections).toEqual([]);
  });
});
