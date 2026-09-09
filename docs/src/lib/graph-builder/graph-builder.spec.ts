/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { SUPPORTED_CONNECTIONS } from '../../../../packages/nx-plugin/src/connection/supported-connections';
import {
  edgePath,
  NODE_HEIGHT,
  NODE_WIDTH,
  sourceAnchor,
  targetAnchor,
  transposePositions,
} from '../../components/graph-builder/geometry';
import {
  buildPresetGraph,
  PRESETS,
} from '../../components/graph-builder/presets';
import {
  EDGE_TYPES,
  findEdgeType,
  INFRA_PROJECT_NAME,
  NODE_TYPES,
  nodeType,
} from './catalog';
import {
  type EmitOptions,
  emitCommands,
  toScript,
  toScriptLines,
} from './commands';
import {
  autoFixesForConnection,
  type Graph,
  type GraphNode,
  validate,
} from './model';

const EMIT: EmitOptions = {
  packageManager: 'pnpm',
  workspace: 'my-project',
  iac: 'cdk',
};

const node = (
  id: string,
  type: string,
  overrides: Partial<GraphNode> = {},
): GraphNode => ({
  id,
  type,
  name: id,
  options: {},
  x: 0,
  y: 0,
  ...overrides,
});

const graph = (
  nodes: GraphNode[],
  edges: { id: string; source: string; target: string }[] = [],
): Graph => ({ nodes, edges });

describe('catalog', () => {
  it('should expose a node type for every connection endpoint', () => {
    const endpoints = new Set(
      SUPPORTED_CONNECTIONS.flatMap(({ source, target }) => [source, target]),
    );
    expect(new Set(NODE_TYPES.map((type) => type.id))).toEqual(endpoints);
  });

  it('should expose an edge type per supported connection', () => {
    expect(EDGE_TYPES).toHaveLength(SUPPORTED_CONNECTIONS.length);
    for (const { source, target } of SUPPORTED_CONNECTIONS) {
      expect(findEdgeType(source, target)).toBeDefined();
    }
  });

  it('should not invent edges the plugin does not support', () => {
    // A website cannot reach a database directly — it goes through an API.
    expect(findEdgeType('ts#react-website', 'ts#rdb')).toBeUndefined();
  });

  it('should give every node type at least one role', () => {
    for (const type of NODE_TYPES) {
      expect(type.roles.length, `${type.id} has no role`).toBeGreaterThan(0);
    }
  });

  it('should read properties from the generator schema', () => {
    // The agent generator's protocol option, straight out of its schema.
    const agent = nodeType('ts#agent');
    const protocol = agent.properties.find((p) => p.name === 'protocol');
    expect(protocol?.enum).toEqual(['http', 'a2a', 'ag-ui']);
    expect(protocol?.default).toBe('http');
  });

  it('should hide the options the builder drives itself', () => {
    for (const type of NODE_TYPES) {
      const names = type.properties.map((p) => p.name);
      expect(names).not.toContain('name');
      expect(names).not.toContain('project');
      expect(names).not.toContain('preferInstallDependencies');
    }
  });

  it('should hide the variant options that select the node type', () => {
    // ts#api produces both tRPC and Smithy APIs, so `framework` is pinned by the
    // node type rather than offered as a property.
    const trpc = nodeType('ts#trpc-api');
    expect(trpc.variantOptions).toEqual({ framework: 'trpc' });
    expect(trpc.properties.map((p) => p.name)).not.toContain('framework');
  });

  it('should badge only the logos two languages share', () => {
    // Strands and DynamoDB are used by both languages, so the mark alone is
    // ambiguous; tRPC and FastAPI already imply one.
    expect(nodeType('ts#agent').badge).toBe('typescript');
    expect(nodeType('py#agent').badge).toBe('python');
    expect(nodeType('ts#dynamodb').badge).toBe('typescript');
    expect(nodeType('ts#trpc-api').badge).toBeUndefined();
    expect(nodeType('py#fast-api').badge).toBeUndefined();
    expect(nodeType('agentcore-gateway').badge).toBeUndefined();
  });

  it('should give every node type a category and a logo', () => {
    for (const type of NODE_TYPES) {
      expect(type.category, `${type.id} has no category`).toBeTruthy();
      expect(type.logo, `${type.id} has no logo`).toBeTruthy();
    }
  });

  it('should give component types a host generator', () => {
    for (const type of NODE_TYPES) {
      if (type.kind !== 'component') continue;
      expect(type.host, `${type.id} has no host`).toBeDefined();
    }
  });
});

describe('orientation', () => {
  const at = (id: string, x: number, y: number) => ({ id, x, y });

  it('should put the ports on the side edges when flowing horizontally', () => {
    const node = { x: 100, y: 200 };
    expect(sourceAnchor(node, 'horizontal').y).toBe(200 + NODE_HEIGHT / 2);
    // Anchors sit on the port's centre, 1px inside the node's edge.
    expect(sourceAnchor(node, 'horizontal').x).toBe(100 + NODE_WIDTH - 1);
    expect(targetAnchor(node, 'horizontal').x).toBe(101);
  });

  it('should put the ports on the top and bottom edges when flowing vertically', () => {
    const node = { x: 100, y: 200 };
    expect(sourceAnchor(node, 'vertical').x).toBe(100 + NODE_WIDTH / 2);
    expect(sourceAnchor(node, 'vertical').y).toBe(200 + NODE_HEIGHT - 1);
    expect(targetAnchor(node, 'vertical').x).toBe(100 + NODE_WIDTH / 2);
    expect(targetAnchor(node, 'vertical').y).toBe(201);
  });

  it('should curve along the flow axis', () => {
    // Horizontal control points share the endpoints' y; vertical ones share x.
    // The control offset is 60% of the gap, capped at 160 — here 300 * 0.6 = 180
    // clamps to 160.
    const from = { x: 0, y: 50 };
    const to = { x: 300, y: 50 };
    expect(edgePath(from, to, 'horizontal')).toBe(
      'M 0 50 C 160 50, 140 50, 300 50',
    );

    const down = { x: 50, y: 0 };
    const below = { x: 50, y: 300 };
    expect(edgePath(down, below, 'vertical')).toBe(
      'M 50 0 C 50 160, 50 140, 50 300',
    );
  });

  it('should transpose a horizontal chain into a vertical one', () => {
    const nodes = [at('a', 24, 24), at('b', 352, 24), at('c', 680, 24)];
    const moved = transposePositions(nodes, 'vertical');
    // One lane each, so they stack: same x, increasing y.
    expect(new Set(moved.map((m) => m.x)).size).toBe(1);
    expect(moved.map((m) => m.y)).toEqual(
      [...moved.map((m) => m.y)].sort((p, q) => p - q),
    );
  });

  it('should transpose a vertical chain back into a horizontal one', () => {
    const nodes = [at('a', 24, 24), at('b', 24, 160), at('c', 24, 296)];
    const moved = transposePositions(nodes, 'horizontal', 900);
    expect(new Set(moved.map((m) => m.y)).size).toBe(1);
    expect(moved.map((m) => m.x)).toEqual(
      [...moved.map((m) => m.x)].sort((p, q) => p - q),
    );
  });

  it('should be stable across repeated swaps', () => {
    // The point of normalising to lanes: swapping back and forth must not drift.
    let nodes = [at('a', 24, 24), at('b', 352, 24), at('c', 680, 24)];
    const firstVertical = transposePositions(nodes, 'vertical', 900);
    nodes = firstVertical.map((m) => at(m.id, m.x, m.y));
    const firstHorizontal = transposePositions(nodes, 'horizontal', 900);
    nodes = firstHorizontal.map((m) => at(m.id, m.x, m.y));
    const secondVertical = transposePositions(nodes, 'vertical', 900);
    expect(secondVertical).toEqual(firstVertical);

    nodes = secondVertical.map((m) => at(m.id, m.x, m.y));
    expect(transposePositions(nodes, 'horizontal', 900)).toEqual(
      firstHorizontal,
    );
  });

  it('should keep a branching graph on separate lanes', () => {
    // `a` feeds both `b` and `c`, which sit in one lane together.
    const nodes = [at('a', 24, 24), at('b', 352, 24), at('c', 352, 160)];
    const moved = transposePositions(nodes, 'vertical', 900);
    const byId = new Map(moved.map((m) => [m.id, m]));
    // b and c share a row below a, at different x.
    expect(byId.get('b')!.y).toBe(byId.get('c')!.y);
    expect(byId.get('b')!.x).not.toBe(byId.get('c')!.x);
    expect(byId.get('a')!.y).toBeLessThan(byId.get('b')!.y);
  });

  it('should never place a node at a negative coordinate', () => {
    const nodes = [at('a', 24, 24), at('b', 352, 160)];
    for (const to of ['vertical', 'horizontal'] as const) {
      for (const move of transposePositions(nodes, to, 900)) {
        expect(move.x).toBeGreaterThanOrEqual(0);
        expect(move.y).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('should not overlap nodes in either orientation', () => {
    const nodes = [
      at('a', 24, 24),
      at('b', 352, 24),
      at('c', 352, 160),
      at('d', 680, 24),
    ];
    for (const to of ['vertical', 'horizontal'] as const) {
      const moved = transposePositions(nodes, to, 900);
      for (let i = 0; i < moved.length; i += 1) {
        for (let j = i + 1; j < moved.length; j += 1) {
          const overlapping =
            Math.abs(moved[i].x - moved[j].x) < NODE_WIDTH &&
            Math.abs(moved[i].y - moved[j].y) < NODE_HEIGHT;
          expect(
            overlapping,
            `${to}: ${moved[i].id} overlaps ${moved[j].id}`,
          ).toBe(false);
        }
      }
    }
  });

  it('should fit a horizontal layout in the width it is given', () => {
    // Five lanes cannot fit 400px at any spacing, so they wrap rather than
    // running off the edge.
    const nodes = [0, 1, 2, 3, 4].map((i) => at(`n${i}`, 24 + i * 328, 24));
    for (const width of [900, 560, 400]) {
      for (const move of transposePositions(nodes, 'horizontal', width)) {
        expect(
          move.x + NODE_WIDTH,
          `a node overflows a ${width}px canvas`,
        ).toBeLessThanOrEqual(width);
      }
    }
  });

  it('should handle an empty graph', () => {
    expect(transposePositions([], 'vertical')).toEqual([]);
  });
});

describe('commands', () => {
  it('should emit the workspace command first', () => {
    const commands = emitCommands(graph([]), EMIT);
    expect(commands[0].command).toBe(
      'pnpm create @aws/nx-workspace my-project --iac=cdk --interactive=false',
    );
  });

  it('should emit a generator command per project node', () => {
    const commands = emitCommands(
      graph([node('my-api', 'ts#trpc-api'), node('my-table', 'ts#dynamodb')]),
      EMIT,
    );
    expect(commands.map((c) => c.command)).toEqual([
      'pnpm create @aws/nx-workspace my-project --iac=cdk --interactive=false',
      'nx g @aws/nx-plugin:ts#api my-api --framework=trpc',
      'nx g @aws/nx-plugin:ts#dynamodb my-table',
      `nx g @aws/nx-plugin:ts#infra ${INFRA_PROJECT_NAME}`,
    ]);
  });

  it('should emit the host project before the component it hosts', () => {
    const commands = emitCommands(
      graph([node('agent', 'ts#agent', { hostName: 'app' })]),
      EMIT,
    );
    expect(commands.map((c) => c.command)).toEqual([
      'pnpm create @aws/nx-workspace my-project --iac=cdk --interactive=false',
      'nx g @aws/nx-plugin:ts#project app',
      'nx g @aws/nx-plugin:ts#agent --project=app --name=agent',
      `nx g @aws/nx-plugin:ts#infra ${INFRA_PROJECT_NAME}`,
    ]);
  });

  it('should scaffold one host project for components sharing a host', () => {
    const commands = emitCommands(
      graph([
        node('agent', 'ts#agent', { hostName: 'app' }),
        node('tools', 'ts#mcp-server', { hostName: 'app' }),
      ]),
      EMIT,
    );
    const hostCommands = commands.filter((c) =>
      c.command.includes('ts#project'),
    );
    expect(hostCommands).toHaveLength(1);
  });

  it('should snake_case a python host project reference', () => {
    const commands = emitCommands(
      graph([node('agent', 'py#agent', { hostName: 'py-app' })]),
      EMIT,
    );
    // The generator creates `py-app`, which Nx qualifies as `py_app`, so the
    // component command must reference the snake_cased name.
    expect(commands[1].command).toBe(
      'nx g @aws/nx-plugin:py#project py-app --type=application',
    );
    expect(commands[2].command).toBe(
      'nx g @aws/nx-plugin:py#agent --project=py_app --name=agent',
    );
  });

  it('should emit connections after the nodes they wire together', () => {
    const commands = emitCommands(
      graph(
        [node('website', 'ts#react-website'), node('my-api', 'ts#trpc-api')],
        [{ id: 'e1', source: 'website', target: 'my-api' }],
      ),
      EMIT,
    );
    expect(commands.find((c) => c.edgeId === 'e1')!.command).toBe(
      'nx g @aws/nx-plugin:connection --sourceProject=website --targetProject=my-api',
    );
  });

  it('should pass component references so the connection is unambiguous', () => {
    const commands = emitCommands(
      graph(
        [
          node('agent', 'ts#agent', { hostName: 'app' }),
          node('tools', 'ts#mcp-server', { hostName: 'app' }),
        ],
        [{ id: 'e1', source: 'agent', target: 'tools' }],
      ),
      EMIT,
    );
    expect(commands.find((c) => c.edgeId === 'e1')!.command).toBe(
      'nx g @aws/nx-plugin:connection --sourceProject=app --targetProject=app --sourceComponent=agent --targetComponent=tools',
    );
  });

  it('should emit an option the user changed from its default', () => {
    const commands = emitCommands(
      graph([
        node('agent', 'ts#agent', {
          hostName: 'app',
          options: { protocol: 'a2a' },
        }),
      ]),
      EMIT,
    );
    expect(
      commands.find((c) => c.command.includes(':ts#agent'))!.command,
    ).toContain('--protocol=a2a');
  });

  it('should omit an option left at its default', () => {
    const commands = emitCommands(
      graph([
        node('agent', 'ts#agent', {
          hostName: 'app',
          // http is the schema default, so passing it would only lengthen the
          // command.
          options: { protocol: 'http' },
        }),
      ]),
      EMIT,
    );
    expect(
      commands.find((c) => c.command.includes(':ts#agent'))!.command,
    ).not.toContain('--protocol');
  });

  // The website→gateway generator publishes a route per agent already attached
  // to the gateway, so it has to run after the gateway→agent connections
  // regardless of the order the user drew them in.
  it('should emit a website-to-gateway connection after the gateway-to-agent ones', () => {
    const commands = emitCommands(
      graph(
        [
          node('website', 'ts#react-website'),
          node('gateway', 'agentcore-gateway', {
            options: { protocol: 'http' },
          }),
          node('chat', 'ts#agent', {
            hostName: 'agents',
            options: { protocol: 'ag-ui' },
          }),
        ],
        [
          // Drawn website-first, which is the wrong order to generate in.
          { id: 'e1', source: 'website', target: 'gateway' },
          { id: 'e2', source: 'gateway', target: 'chat' },
        ],
      ),
      EMIT,
    );
    const connections = commands.filter((c) =>
      c.command.includes(':connection'),
    );
    expect(connections.map((c) => c.edgeId)).toEqual(['e2', 'e1']);
  });

  it('should keep the drawn order for connections with no ordering rule', () => {
    const commands = emitCommands(
      graph(
        [
          node('website', 'ts#react-website'),
          node('my-api', 'ts#trpc-api'),
          node('my-table', 'ts#dynamodb'),
        ],
        [
          { id: 'e1', source: 'my-api', target: 'my-table' },
          { id: 'e2', source: 'website', target: 'my-api' },
        ],
      ),
      EMIT,
    );
    expect(
      commands
        .filter((c) => c.command.includes(':connection'))
        .map((c) => c.edgeId),
    ).toEqual(['e1', 'e2']);
  });

  it('should emit each connection once even when drawn twice', () => {
    const commands = emitCommands(
      graph(
        [node('website', 'ts#react-website'), node('my-api', 'ts#trpc-api')],
        [
          { id: 'e1', source: 'website', target: 'my-api' },
          { id: 'e2', source: 'website', target: 'my-api' },
        ],
      ),
      EMIT,
    );
    expect(
      commands.filter((c) => c.command.includes(':connection')),
    ).toHaveLength(1);
  });

  it('should cd into the workspace before running generators', () => {
    const script = toScript(graph([node('my-api', 'ts#trpc-api')]), EMIT).split(
      '\n',
    );
    expect(script[0]).toContain('create @aws/nx-workspace');
    expect(script[1]).toBe('cd my-project');
    expect(script[2]).toBe(
      'pnpm nx g @aws/nx-plugin:ts#api my-api --framework=trpc --no-interactive',
    );
  });

  it('should prefix generator commands per package manager', () => {
    const single = graph([node('my-api', 'ts#trpc-api')]);
    expect(toScript(single, { ...EMIT, packageManager: 'npm' })).toContain(
      'npx nx g',
    );
    expect(toScript(single, { ...EMIT, packageManager: 'bun' })).toContain(
      'bunx nx g',
    );
  });

  it('should keep the graph element each script line came from', () => {
    const website = node('website', 'ts#react-website');
    const api = node('my-api', 'ts#trpc-api');
    const lines = toScriptLines(
      graph(
        [website, api],
        [{ id: 'e1', source: 'website', target: 'my-api' }],
      ),
      EMIT,
    );

    // The workspace create and the `cd` belong to no element; every generator
    // line points back at the node or edge it scaffolds, so a view showing the
    // graph beside the commands can tie the two together.
    expect(lines[0].nodeId).toBeUndefined();
    expect(lines[1].command).toBe('cd my-project');
    expect(lines[1].comment).toBeUndefined();
    expect(
      lines.find((line) => line.command.includes(':ts#website '))?.nodeId,
    ).toBe('website');
    expect(
      lines.find((line) => line.command.includes(':connection'))?.edgeId,
    ).toBe('e1');
  });

  it('should skip the workspace lines when asked', () => {
    const lines = toScriptLines(graph([node('my-api', 'ts#trpc-api')]), EMIT, {
      skipWorkspace: true,
    });
    expect(lines[0].command).toBe(
      'pnpm nx g @aws/nx-plugin:ts#api my-api --framework=trpc --no-interactive',
    );
  });

  it('should kebab-case a workspace name for the cd', () => {
    const script = toScript(graph([]), { ...EMIT, workspace: 'My Project' });
    expect(script).toContain('cd my-project');
  });

  it('should emit terraform as the iac provider when chosen', () => {
    const commands = emitCommands(graph([]), { ...EMIT, iac: 'terraform' });
    expect(commands[0].command).toContain('--iac=terraform');
  });

  describe('follow-up generators', () => {
    it('should add auth to a website', () => {
      const commands = emitCommands(
        graph([node('website', 'ts#react-website')]),
        EMIT,
      );
      expect(commands.map((c) => c.command)).toContain(
        'nx g @aws/nx-plugin:ts#website#auth --project=website',
      );
    });

    it('should add auth immediately after creating the website', () => {
      const commands = emitCommands(
        graph([node('website', 'ts#react-website')]),
        EMIT,
      );
      const create = commands.findIndex((c) =>
        c.command.includes(':ts#website '),
      );
      const auth = commands.findIndex((c) =>
        c.command.includes(':ts#website#auth'),
      );
      expect(auth).toBe(create + 1);
    });

    it('should add auth to every website in the graph', () => {
      const commands = emitCommands(
        graph([
          node('one', 'ts#react-website'),
          node('two', 'ts#react-website'),
        ]),
        EMIT,
      );
      expect(
        commands.filter((c) => c.command.includes(':ts#website#auth')),
      ).toHaveLength(2);
    });

    it('should attribute the auth command to its website node', () => {
      const commands = emitCommands(
        graph([node('website', 'ts#react-website')]),
        EMIT,
      );
      const auth = commands.find((c) => c.command.includes(':ts#website#auth'));
      expect(auth?.nodeId).toBe('website');
    });

    it('should not add follow-ups to types that have none', () => {
      const commands = emitCommands(
        graph([node('my-api', 'ts#trpc-api'), node('db', 'ts#rdb')]),
        EMIT,
      );
      // Workspace, the two projects, and infra — nothing extra.
      expect(commands).toHaveLength(4);
    });
  });

  describe('overrides', () => {
    it('should pass an overridden name to a project generator', () => {
      const commands = emitCommands(graph([node('my-api', 'ts#trpc-api')]), {
        ...EMIT,
        overrides: { 'my-api': { generatorName: 'MyApi' } },
      });
      expect(commands.map((c) => c.command)).toContain(
        'nx g @aws/nx-plugin:ts#api MyApi --framework=trpc',
      );
    });

    it('should still reference an overridden project by its kebab-cased name', () => {
      const commands = emitCommands(
        graph(
          [node('website', 'ts#react-website'), node('my-api', 'ts#trpc-api')],
          [{ id: 'e1', source: 'website', target: 'my-api' }],
        ),
        {
          ...EMIT,
          overrides: {
            website: { generatorName: 'MyWebsite' },
            'my-api': { generatorName: 'MyApi' },
          },
        },
      );
      expect(commands.map((c) => c.command)).toContain(
        'nx g @aws/nx-plugin:connection --sourceProject=my-website --targetProject=my-api',
      );
    });

    it('should target a follow-up generator at the overridden project', () => {
      const commands = emitCommands(
        graph([node('website', 'ts#react-website')]),
        { ...EMIT, overrides: { website: { generatorName: 'GameUI' } } },
      );
      expect(commands.map((c) => c.command)).toContain(
        'nx g @aws/nx-plugin:ts#website#auth --project=game-ui',
      );
    });

    it('should leave the name off when the generator should derive it', () => {
      const commands = emitCommands(
        graph([node('mcp', 'ts#mcp-server', { hostName: 'tools' })]),
        { ...EMIT, overrides: { mcp: { generatorName: null } } },
      );
      expect(commands.map((c) => c.command)).toContain(
        'nx g @aws/nx-plugin:ts#mcp-server --project=tools',
      );
    });

    it('should reference a derived component by the name the generator records', () => {
      const commands = emitCommands(
        graph(
          [
            node('agent', 'py#agent', {
              hostName: 'py-agents',
              options: { protocol: 'a2a' },
            }),
            node('mcp', 'ts#mcp-server', { hostName: 'tools' }),
          ],
          [{ id: 'e1', source: 'agent', target: 'mcp' }],
        ),
        {
          ...EMIT,
          overrides: {
            agent: { generatorName: null, componentName: 'agent' },
            mcp: { generatorName: null, componentName: 'mcp-server' },
          },
        },
      );
      expect(commands.map((c) => c.command)).toContain(
        'nx g @aws/nx-plugin:connection --sourceProject=py_agents --targetProject=tools --sourceComponent=agent --targetComponent=mcp-server',
      );
    });

    it('should pin option values on a node generator', () => {
      const commands = emitCommands(graph([node('my-api', 'ts#trpc-api')]), {
        ...EMIT,
        overrides: { 'my-api': { options: { auth: 'cognito' } } },
      });
      expect(commands.map((c) => c.command)).toContain(
        'nx g @aws/nx-plugin:ts#api my-api --framework=trpc --auth=cognito',
      );
    });

    it('should pin option values on a follow-up generator', () => {
      const commands = emitCommands(
        graph([node('website', 'ts#react-website')]),
        {
          ...EMIT,
          overrides: {
            website: {
              followUps: {
                'ts#website#auth': {
                  cognitoDomain: 'my-demo',
                  allowSignup: true,
                },
              },
            },
          },
        },
      );
      expect(commands.map((c) => c.command)).toContain(
        'nx g @aws/nx-plugin:ts#website#auth --project=website --cognitoDomain=my-demo --allowSignup=true',
      );
    });

    it('should leave a node with no override untouched', () => {
      const withOverrides = emitCommands(
        graph([node('my-api', 'ts#trpc-api'), node('db', 'ts#dynamodb')]),
        { ...EMIT, overrides: { db: { generatorName: 'MyTable' } } },
      );
      expect(withOverrides.map((c) => c.command)).toContain(
        'nx g @aws/nx-plugin:ts#api my-api --framework=trpc',
      );
    });
  });

  describe('infrastructure project', () => {
    it('should append a CDK infra project last', () => {
      const commands = emitCommands(
        graph(
          [node('website', 'ts#react-website'), node('my-api', 'ts#trpc-api')],
          [{ id: 'e1', source: 'website', target: 'my-api' }],
        ),
        EMIT,
      );
      expect(commands.at(-1)!.command).toBe(
        `nx g @aws/nx-plugin:ts#infra ${INFRA_PROJECT_NAME}`,
      );
    });

    it('should append a Terraform infra project when that is the iac choice', () => {
      const commands = emitCommands(graph([node('my-api', 'ts#trpc-api')]), {
        ...EMIT,
        iac: 'terraform',
      });
      expect(commands.at(-1)!.command).toBe(
        `nx g @aws/nx-plugin:terraform#project ${INFRA_PROJECT_NAME} --type=application`,
      );
    });

    it('should append exactly one infra project', () => {
      const commands = emitCommands(
        graph([
          node('a', 'ts#trpc-api'),
          node('b', 'ts#dynamodb'),
          node('c', 'ts#agent', { hostName: 'app' }),
        ]),
        EMIT,
      );
      const infra = commands.filter((c) =>
        /:(ts#infra|terraform#project) /.test(c.command),
      );
      expect(infra).toHaveLength(1);
    });

    it('should emit the infra project after every connection', () => {
      const commands = emitCommands(
        graph(
          [node('website', 'ts#react-website'), node('my-api', 'ts#trpc-api')],
          [{ id: 'e1', source: 'website', target: 'my-api' }],
        ),
        EMIT,
      );
      const lastConnection = commands.findLastIndex((c) =>
        c.command.includes(':connection'),
      );
      const infra = commands.findIndex((c) => c.command.includes(':ts#infra'));
      expect(infra).toBeGreaterThan(lastConnection);
    });

    it('should not append an infra project to an empty graph', () => {
      // Nothing to deploy, so the script is just the workspace command.
      const commands = emitCommands(graph([]), EMIT);
      expect(commands).toHaveLength(1);
    });
  });
});

describe('autoFixesForConnection', () => {
  it('should switch an agent to ag-ui when a website connects to it', () => {
    const website = node('w', 'ts#react-website');
    const agent = node('a', 'ts#agent', { hostName: 'app' });
    expect(autoFixesForConnection(website, agent)).toEqual([
      { nodeId: 'a', option: 'protocol', value: 'ag-ui' },
    ]);
  });

  it('should switch the target agent to a2a when an agent connects to it', () => {
    const source = node('a', 'ts#agent', { hostName: 'app' });
    const target = node('b', 'ts#agent', { hostName: 'app' });
    const fixes = autoFixesForConnection(source, target);
    // Only the target changes: the source keeps whatever protocol it serves on.
    expect(fixes).toContainEqual({
      nodeId: 'b',
      option: 'protocol',
      value: 'a2a',
    });
    expect(fixes.every((fix) => fix.nodeId === 'b')).toBe(true);
  });

  it('should switch a python target agent to a2a too', () => {
    const source = node('a', 'ts#agent', { hostName: 'app' });
    const target = node('b', 'py#agent', { hostName: 'py-app' });
    expect(autoFixesForConnection(source, target)).toContainEqual({
      nodeId: 'b',
      option: 'protocol',
      value: 'a2a',
    });
  });

  it('should not overwrite a protocol the user chose', () => {
    const website = node('w', 'ts#react-website');
    const agent = node('a', 'ts#agent', {
      hostName: 'app',
      options: { protocol: 'http' },
    });
    expect(autoFixesForConnection(website, agent)).toEqual([]);
  });

  it('should not fix an option already at the required default', () => {
    // `auth` defaults to iam, which is what the connection needs, so there is
    // nothing to change.
    const agent = node('a', 'ts#agent', { hostName: 'app' });
    const mcp = node('m', 'ts#mcp-server', { hostName: 'app' });
    expect(
      autoFixesForConnection(agent, mcp).some((fix) => fix.option === 'auth'),
    ).toBe(false);
  });

  it('should not fix anything for an unsupported connection', () => {
    const website = node('w', 'ts#react-website');
    const db = node('d', 'ts#rdb');
    expect(autoFixesForConnection(website, db)).toEqual([]);
  });

  it('should not fix anything for a connection with no pinned constraint', () => {
    const website = node('w', 'ts#react-website');
    const api = node('a', 'ts#trpc-api');
    expect(autoFixesForConnection(website, api)).toEqual([]);
  });

  it('should leave a graph valid once its fixes are applied', () => {
    // The point of the fix: what would have been a validation error becomes a
    // graph that scaffolds.
    const source = node('a', 'ts#agent', { hostName: 'app', name: 'one' });
    const target = node('b', 'ts#agent', { hostName: 'app', name: 'two' });
    const before = graph(
      [source, target],
      [{ id: 'e1', source: 'a', target: 'b' }],
    );
    expect(validate(before).length).toBeGreaterThan(0);

    const fixes = autoFixesForConnection(source, target);
    const after = graph(
      [source, target].map((n) => ({
        ...n,
        options: {
          ...n.options,
          ...Object.fromEntries(
            fixes
              .filter((f) => f.nodeId === n.id)
              .map((f) => [f.option, f.value]),
          ),
        },
      })),
      [{ id: 'e1', source: 'a', target: 'b' }],
    );
    expect(validate(after)).toEqual([]);
  });

  // A gateway serves one protocol or the other, and what it fronts decides
  // which: whichever kind of target is attached first settles it.
  it('should switch a gateway to http when an agent is attached', () => {
    const gateway = node('g', 'agentcore-gateway');
    const agent = node('a', 'ts#agent', { hostName: 'app' });
    expect(autoFixesForConnection(gateway, agent)).toContainEqual({
      nodeId: 'g',
      option: 'protocol',
      value: 'http',
    });
  });

  it('should switch a gateway to http for a python agent too', () => {
    const gateway = node('g', 'agentcore-gateway');
    const agent = node('a', 'py#agent', { hostName: 'py-app' });
    expect(autoFixesForConnection(gateway, agent)).toContainEqual({
      nodeId: 'g',
      option: 'protocol',
      value: 'http',
    });
  });

  it('should leave a gateway on mcp when an MCP server is attached', () => {
    // `mcp` is the schema default, so there is nothing to change — and nothing
    // should push it to http.
    const gateway = node('g', 'agentcore-gateway');
    const mcp = node('m', 'ts#mcp-server', { hostName: 'app' });
    expect(
      autoFixesForConnection(gateway, mcp).some(
        (fix) => fix.nodeId === 'g' && fix.option === 'protocol',
      ),
    ).toBe(false);
  });

  it('should switch a gateway to http when a website connects to it', () => {
    const website = node('w', 'ts#react-website');
    const gateway = node('g', 'agentcore-gateway');
    expect(autoFixesForConnection(website, gateway)).toContainEqual({
      nodeId: 'g',
      option: 'protocol',
      value: 'http',
    });
  });

  it('should not switch a gateway protocol the user chose', () => {
    const gateway = node('g', 'agentcore-gateway', {
      options: { protocol: 'mcp' },
    });
    const agent = node('a', 'ts#agent', { hostName: 'app' });
    expect(
      autoFixesForConnection(gateway, agent).some(
        (fix) => fix.nodeId === 'g' && fix.option === 'protocol',
      ),
    ).toBe(false);
  });
});

describe('validate', () => {
  it('should accept a graph with named nodes and a supported edge', () => {
    const issues = validate(
      graph(
        [node('website', 'ts#react-website'), node('my-api', 'ts#trpc-api')],
        [{ id: 'e1', source: 'website', target: 'my-api' }],
      ),
    );
    expect(issues).toEqual([]);
  });

  it('should require a name', () => {
    const issues = validate(graph([node('a', 'ts#trpc-api', { name: '  ' })]));
    expect(issues).toEqual([
      expect.objectContaining({ severity: 'error', nodeId: 'a' }),
    ]);
  });

  it('should require a host project name for a component', () => {
    const issues = validate(graph([node('a', 'ts#agent')]));
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'error',
        message: expect.stringContaining('host project name'),
      }),
    ]);
  });

  it('should reject a project claiming the reserved infra name', () => {
    const issues = validate(
      graph([node('a', 'ts#trpc-api', { name: INFRA_PROJECT_NAME })]),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'error',
        nodeId: 'a',
        message: expect.stringContaining('reserved'),
      }),
    ]);
  });

  it('should reject a component host claiming the reserved infra name', () => {
    const issues = validate(
      graph([
        node('a', 'ts#agent', { name: 'agent', hostName: INFRA_PROJECT_NAME }),
      ]),
    );
    expect(issues.some((i) => i.message.includes('reserved'))).toBe(true);
  });

  it('should reject a name that kebab-cases to the reserved infra name', () => {
    // The generator kebab-cases the name it is given, so `Infra` collides too.
    const issues = validate(
      graph([node('a', 'ts#trpc-api', { name: 'Infra' })]),
    );
    expect(issues.some((i) => i.message.includes('reserved'))).toBe(true);
  });

  it('should reject two projects sharing a name', () => {
    const issues = validate(
      graph([
        node('a', 'ts#trpc-api', { name: 'dup' }),
        node('b', 'ts#dynamodb', { name: 'dup' }),
      ]),
    );
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(2);
  });

  it('should accept components sharing a host project name', () => {
    const issues = validate(
      graph([
        node('a', 'ts#agent', { name: 'agent', hostName: 'app' }),
        node('b', 'ts#mcp-server', { name: 'tools', hostName: 'app' }),
      ]),
    );
    expect(issues).toEqual([]);
  });

  it('should reject a project name colliding with a component host name', () => {
    const issues = validate(
      graph([
        node('a', 'ts#trpc-api', { name: 'app' }),
        node('b', 'ts#agent', { name: 'agent', hostName: 'app' }),
      ]),
    );
    expect(issues.some((i) => i.message.includes('component host'))).toBe(true);
  });

  it('should reject two components of one project sharing a name', () => {
    const issues = validate(
      graph([
        node('a', 'ts#agent', { name: 'dup', hostName: 'app' }),
        node('b', 'ts#agent', { name: 'dup', hostName: 'app' }),
      ]),
    );
    expect(
      issues.some((i) => i.message.includes('already has a component named')),
    ).toBe(true);
  });

  it('should reject a host project that would need two languages', () => {
    const issues = validate(
      graph([
        node('a', 'ts#agent', { name: 'agent', hostName: 'shared' }),
        node('b', 'py#agent', { name: 'py-agent', hostName: 'shared' }),
      ]),
    );
    expect(issues.some((i) => i.message.includes('Use separate host'))).toBe(
      true,
    );
  });

  it('should reject an unsupported edge', () => {
    const issues = validate(
      graph(
        [node('website', 'ts#react-website'), node('db', 'ts#rdb')],
        [{ id: 'e1', source: 'website', target: 'db' }],
      ),
    );
    expect(issues).toEqual([
      expect.objectContaining({
        severity: 'error',
        edgeId: 'e1',
        message: expect.stringContaining('does not support'),
      }),
    ]);
  });

  it('should warn about a duplicated edge rather than error', () => {
    const issues = validate(
      graph(
        [node('website', 'ts#react-website'), node('my-api', 'ts#trpc-api')],
        [
          { id: 'e1', source: 'website', target: 'my-api' },
          { id: 'e2', source: 'website', target: 'my-api' },
        ],
      ),
    );
    expect(issues).toEqual([
      expect.objectContaining({ severity: 'warning', edgeId: 'e2' }),
    ]);
  });

  describe('connection constraints', () => {
    it('should require an a2a target for an agent-to-agent connection', () => {
      const issues = validate(
        graph(
          [
            node('a', 'ts#agent', { name: 'orchestrator', hostName: 'app' }),
            // Left at the http default, which the A2A connection refuses.
            node('b', 'ts#agent', { name: 'worker', hostName: 'app' }),
          ],
          [{ id: 'e1', source: 'a', target: 'b' }],
        ),
      );
      expect(issues).toEqual([
        expect.objectContaining({
          severity: 'error',
          edgeId: 'e1',
          nodeId: 'b',
          message: expect.stringContaining("protocol must be 'a2a'"),
        }),
      ]);
    });

    it('should accept an agent-to-agent connection to an a2a target', () => {
      const issues = validate(
        graph(
          [
            node('a', 'ts#agent', { name: 'orchestrator', hostName: 'app' }),
            node('b', 'ts#agent', {
              name: 'worker',
              hostName: 'app',
              options: { protocol: 'a2a' },
            }),
          ],
          [{ id: 'e1', source: 'a', target: 'b' }],
        ),
      );
      expect(issues).toEqual([]);
    });

    it('should reject a website connecting to an a2a agent', () => {
      const issues = validate(
        graph(
          [
            node('w', 'ts#react-website', { name: 'website' }),
            node('a', 'ts#agent', {
              name: 'agent',
              hostName: 'app',
              options: { protocol: 'a2a' },
            }),
          ],
          [{ id: 'e1', source: 'w', target: 'a' }],
        ),
      );
      expect(issues).toEqual([
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining("protocol cannot be 'a2a'"),
        }),
      ]);
    });

    it('should require iam auth on an mcp server an agent reaches', () => {
      const issues = validate(
        graph(
          [
            node('a', 'ts#agent', { name: 'agent', hostName: 'app' }),
            node('m', 'ts#mcp-server', {
              name: 'tools',
              hostName: 'app',
              options: { auth: 'cognito' },
            }),
          ],
          [{ id: 'e1', source: 'a', target: 'm' }],
        ),
      );
      expect(issues).toEqual([
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining("auth must be 'iam'"),
        }),
      ]);
    });

    it('should reject a gateway connected to itself', () => {
      const issues = validate(
        graph(
          [node('g', 'agentcore-gateway', { name: 'gateway' })],
          [{ id: 'e1', source: 'g', target: 'g' }],
        ),
      );
      expect(
        issues.some((i) => i.message.includes('cannot connect to itself')),
      ).toBe(true);
    });

    it('should reject a cycle of gateway connections', () => {
      const issues = validate(
        graph(
          [
            node('a', 'agentcore-gateway', { name: 'one' }),
            node('b', 'agentcore-gateway', { name: 'two' }),
          ],
          [
            { id: 'e1', source: 'a', target: 'b' },
            { id: 'e2', source: 'b', target: 'a' },
          ],
        ),
      );
      expect(issues.some((i) => i.message.includes('cycle'))).toBe(true);
    });

    it('should accept a chain of gateway connections', () => {
      const issues = validate(
        graph(
          [
            node('a', 'agentcore-gateway', { name: 'one' }),
            node('b', 'agentcore-gateway', { name: 'two' }),
          ],
          [{ id: 'e1', source: 'a', target: 'b' }],
        ),
      );
      expect(issues).toEqual([]);
    });

    it('should accept two agents each holding the other as an a2a tool', () => {
      // Unlike gateways, mutual agent references are legitimate.
      const issues = validate(
        graph(
          [
            node('a', 'ts#agent', {
              name: 'one',
              hostName: 'app',
              options: { protocol: 'a2a' },
            }),
            node('b', 'ts#agent', {
              name: 'two',
              hostName: 'app',
              options: { protocol: 'a2a' },
            }),
          ],
          [
            { id: 'e1', source: 'a', target: 'b' },
            { id: 'e2', source: 'b', target: 'a' },
          ],
        ),
      );
      expect(issues).toEqual([]);
    });
  });
});

describe('presets', () => {
  it.each(PRESETS.map((preset) => [preset.label, preset] as const))(
    'should build a valid graph for %s',
    (_label, preset) => {
      const built = buildPresetGraph(preset);
      expect(validate(built)).toEqual([]);
    },
  );

  it.each(PRESETS.map((preset) => [preset.label, preset] as const))(
    'should keep every declared edge for %s',
    (_label, preset) => {
      // An edge dropped here means the preset names a connection the plugin no
      // longer supports.
      expect(buildPresetGraph(preset).edges).toHaveLength(preset.edges.length);
    },
  );

  it.each(PRESETS.map((preset) => [preset.label, preset] as const))(
    'should emit a command per node and connection for %s',
    (_label, preset) => {
      const built = buildPresetGraph(preset);
      const commands = emitCommands(built, EMIT);
      const connectionCommands = commands.filter((c) =>
        c.command.includes(':connection'),
      );
      expect(connectionCommands).toHaveLength(built.edges.length);
      for (const graphNode of built.nodes) {
        expect(
          commands.some((c) => c.nodeId === graphNode.id),
          `${graphNode.name} has no command`,
        ).toBe(true);
      }
    },
  );

  it.each([
    ['a wide canvas', 900],
    ['a mid-width canvas', 560],
    ['a narrow canvas', 400],
    ['an unknown width', undefined],
  ])('should keep every preset node within %s', (_label, width) => {
    for (const preset of PRESETS) {
      const built = buildPresetGraph(preset, width as number | undefined);
      for (const graphNode of built.nodes) {
        // A node whose right edge passes the canvas width would sit half off it.
        if (width !== undefined) {
          expect(
            graphNode.x + NODE_WIDTH,
            `${preset.label}/${graphNode.name} overflows a ${width}px canvas`,
          ).toBeLessThanOrEqual(width as number);
        }
        expect(graphNode.x).toBeGreaterThanOrEqual(0);
        expect(graphNode.y).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it.each([
    ['a wide canvas', 900],
    ['a narrow canvas', 400],
  ])('should not overlap preset nodes on %s', (_label, width) => {
    for (const preset of PRESETS) {
      const nodes = buildPresetGraph(preset, width as number).nodes;
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const overlapping =
            Math.abs(nodes[i].x - nodes[j].x) < NODE_WIDTH &&
            Math.abs(nodes[i].y - nodes[j].y) < NODE_HEIGHT;
          expect(
            overlapping,
            `${preset.label}: ${nodes[i].name} overlaps ${nodes[j].name}`,
          ).toBe(false);
        }
      }
    }
  });

  it('should keep a preset valid however it is laid out', () => {
    // Wrapping changes coordinates only, never which nodes or edges exist.
    for (const preset of PRESETS) {
      const wide = buildPresetGraph(preset, 900);
      const narrow = buildPresetGraph(preset, 400);
      expect(narrow.nodes.map((n) => n.name)).toEqual(
        wide.nodes.map((n) => n.name),
      );
      expect(narrow.edges).toHaveLength(wide.edges.length);
      expect(validate(narrow)).toEqual([]);
    }
  });

  it('should lay preset nodes out without overlapping', () => {
    for (const preset of PRESETS) {
      const positions = buildPresetGraph(preset).nodes.map(
        (n) => `${n.x},${n.y}`,
      );
      expect(new Set(positions).size).toBe(positions.length);
    }
  });
});
