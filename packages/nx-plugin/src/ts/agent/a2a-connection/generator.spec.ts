/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { expectHasMetricTags } from '../../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import {
  TS_AGENT_A2A_CONNECTION_GENERATOR_INFO,
  tsAgentA2aConnectionGenerator,
} from './generator';

describe('ts#agent#a2a-connection generator', () => {
  let tree: Tree;

  const HOST = {
    generator: 'ts#agent' as const,
    name: 'host',
    path: 'src/host',
    port: 8081,
    rc: 'Host',
    auth: 'iam' as const,
    protocol: 'http' as const,
  };

  const REMOTE = {
    generator: 'ts#agent' as const,
    name: 'remote',
    path: 'src/remote',
    port: 9000,
    rc: 'Remote',
    auth: 'iam' as const,
    protocol: 'a2a' as const,
  };

  const setupProjects = () => {
    tree.write(
      'apps/ts-host/project.json',
      JSON.stringify({
        name: '@test/ts-host',
        root: 'apps/ts-host',
        sourceRoot: 'apps/ts-host/src',
        targets: {
          'host-serve': {
            executor: 'nx:run-commands',
            options: { commands: ['echo serve'] },
            continuous: true,
          },
          'host-serve-local': {
            executor: 'nx:run-commands',
            options: {
              commands: ['echo serve-local'],
              env: { PORT: '8081', SERVE_LOCAL: 'true' },
            },
            dependsOn: [],
            continuous: true,
          },
        },
        metadata: { components: [HOST] },
      }),
    );

    tree.write(
      'apps/ts-host/src/host/agent.ts',
      `import { Agent, tool } from '@strands-agents/sdk';
import { z } from 'zod';

const multiply = tool({
  name: 'Multiply',
  description: 'Multiply two numbers',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  callback: ({ a, b }) => a * b,
});

export const getAgent = async (sessionId: string) =>
  new Agent({
    systemPrompt: 'You are a mathematical wizard.',
    tools: [multiply],
  });
`,
    );

    tree.write(
      'apps/ts-remote/project.json',
      JSON.stringify({
        name: '@test/ts-remote',
        root: 'apps/ts-remote',
        sourceRoot: 'apps/ts-remote/src',
        targets: {
          'remote-serve-local': {
            executor: 'nx:run-commands',
            options: {
              commands: ['echo remote-serve-local'],
              env: { PORT: '9000', SERVE_LOCAL: 'true' },
            },
            continuous: true,
          },
        },
        metadata: { components: [REMOTE] },
      }),
    );
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should vend per-connection A2A client in shared agent-connection project', async () => {
    setupProjects();
    await tsAgentA2aConnectionGenerator(tree, {
      sourceProject: '@test/ts-host',
      targetProject: '@test/ts-remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });

    // agent-connection project created with core A2A client
    expect(tree.exists('packages/common/agent-connection/project.json')).toBe(
      true,
    );
    expect(
      tree.exists(
        'packages/common/agent-connection/src/core/agentcore-a2a-client-strands.ts',
      ),
    ).toBe(true);
    // Layer 1 (framework-agnostic client config) + Layer 0 (shared fetch)
    expect(
      tree.exists(
        'packages/common/agent-connection/src/core/agentcore-a2a-client-config.ts',
      ),
    ).toBe(true);
    expect(
      tree.exists(
        'packages/common/agent-connection/src/core/agentcore-fetch.ts',
      ),
    ).toBe(true);

    // Per-connection client vended into app/
    const clientPath =
      'packages/common/agent-connection/src/app/remote-client.ts';
    expect(tree.exists(clientPath)).toBe(true);
    const client = tree.read(clientPath, 'utf-8')!;
    expect(client).toContain('RemoteClientStrands');
    expect(client).toContain('SERVE_LOCAL');
    expect(client).toContain('http://localhost:9000/');
    expect(client).toContain('AgentCoreA2aClientStrands.withIamAuth');

    // index.ts re-exports
    const index = tree.read(
      'packages/common/agent-connection/src/index.ts',
      'utf-8',
    )!;
    expect(index).toContain('remote-client');
  });

  it('should transform agent.ts to wire the remote as a tool', async () => {
    setupProjects();
    await tsAgentA2aConnectionGenerator(tree, {
      sourceProject: '@test/ts-host',
      targetProject: '@test/ts-remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });

    const agent = tree.read('apps/ts-host/src/host/agent.ts', 'utf-8')!;
    expect(agent).toContain('RemoteClientStrands');
    expect(agent).toContain('RemoteClientStrands.create()');
    expect(agent).toContain("name: 'askRemote'");
    expect(agent).toContain('remote.invoke(prompt)');
    expect(agent).toContain('remoteTool');
  });

  it('should make host serve-local depend on remote serve-local', async () => {
    setupProjects();
    await tsAgentA2aConnectionGenerator(tree, {
      sourceProject: '@test/ts-host',
      targetProject: '@test/ts-remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });

    const host = JSON.parse(tree.read('apps/ts-host/project.json', 'utf-8')!);
    expect(host.targets['host-serve-local'].dependsOn).toEqual([
      { projects: ['@test/ts-remote'], target: 'remote-serve-local' },
    ]);
  });

  it('should throw when target is not an A2A agent', async () => {
    setupProjects();
    await expect(
      tsAgentA2aConnectionGenerator(tree, {
        sourceProject: '@test/ts-host',
        targetProject: '@test/ts-remote',
        sourceComponent: HOST,
        targetComponent: { ...REMOTE, protocol: 'http' },
      }),
    ).rejects.toThrow(/A2A/);
  });

  it('should throw when target agent uses non-IAM auth', async () => {
    setupProjects();
    await expect(
      tsAgentA2aConnectionGenerator(tree, {
        sourceProject: '@test/ts-host',
        targetProject: '@test/ts-remote',
        sourceComponent: HOST,
        targetComponent: { ...REMOTE, auth: 'cognito' },
      }),
    ).rejects.toThrow(/IAM/);
  });

  it('should add generator metric', async () => {
    setupProjects();
    await sharedConstructsGenerator(tree, { iac: 'cdk' });
    await tsAgentA2aConnectionGenerator(tree, {
      sourceProject: '@test/ts-host',
      targetProject: '@test/ts-remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });
    expectHasMetricTags(tree, TS_AGENT_A2A_CONNECTION_GENERATOR_INFO.metric);
  });

  // --- AST transform edge cases ---

  it('should not duplicate the `tool` import if already present', async () => {
    setupProjects();
    await tsAgentA2aConnectionGenerator(tree, {
      sourceProject: '@test/ts-host',
      targetProject: '@test/ts-remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });
    const agent = tree.read('apps/ts-host/src/host/agent.ts', 'utf-8')!;
    const imports = agent.match(/from '@strands-agents\/sdk'/g) ?? [];
    expect(imports).toHaveLength(1);
    // `tool` appears once in the import list
    const importLine = agent
      .split('\n')
      .find((l) => l.includes("from '@strands-agents/sdk'"));
    expect(importLine).toBeDefined();
    expect((importLine!.match(/\btool\b/g) ?? []).length).toBe(1);
  });

  it('should not duplicate the `z` import if already present', async () => {
    setupProjects();
    await tsAgentA2aConnectionGenerator(tree, {
      sourceProject: '@test/ts-host',
      targetProject: '@test/ts-remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });
    const agent = tree.read('apps/ts-host/src/host/agent.ts', 'utf-8')!;
    const zImports = agent.match(/from 'zod'/g) ?? [];
    expect(zImports).toHaveLength(1);
  });

  it('should not match unrelated `tools: [...]` keyword arguments in the same file', async () => {
    setupProjects();
    // Add an unrelated `tools: []` somewhere else in the file — generator
    // must not append the remote tool to it.
    tree.write(
      'apps/ts-host/src/host/agent.ts',
      `import { Agent, tool } from '@strands-agents/sdk';
import { z } from 'zod';

// Unrelated config object that happens to have a \`tools\` key.
const unrelatedConfig = { tools: [] };

const multiply = tool({
  name: 'Multiply',
  description: 'Multiply two numbers',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  callback: ({ a, b }) => a * b,
});

export const getAgent = async (sessionId: string) =>
  new Agent({
    systemPrompt: 'You are a mathematical wizard.',
    tools: [multiply],
  });
`,
    );

    await tsAgentA2aConnectionGenerator(tree, {
      sourceProject: '@test/ts-host',
      targetProject: '@test/ts-remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });

    const agent = tree.read('apps/ts-host/src/host/agent.ts', 'utf-8')!;
    // The unrelated config object's `tools: []` is unchanged
    expect(agent).toContain('const unrelatedConfig = { tools: [] };');
    // The Agent's tools array got the new tool appended
    expect(agent).toMatch(/tools: \[multiply, remoteTool\]/);
  });

  it('should be idempotent — re-running the generator does not duplicate the tool', async () => {
    setupProjects();
    await tsAgentA2aConnectionGenerator(tree, {
      sourceProject: '@test/ts-host',
      targetProject: '@test/ts-remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });
    await tsAgentA2aConnectionGenerator(tree, {
      sourceProject: '@test/ts-host',
      targetProject: '@test/ts-remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });
    const agent = tree.read('apps/ts-host/src/host/agent.ts', 'utf-8')!;
    expect((agent.match(/remoteTool/g) ?? []).length).toBeGreaterThanOrEqual(1);
    // Tool creation appears exactly once
    expect((agent.match(/RemoteClientStrands\.create/g) ?? []).length).toBe(1);
    // The `tools` array contains `remoteTool` exactly once
    const toolsArrayMatch = agent.match(/tools: \[([^\]]*)\]/);
    expect(toolsArrayMatch).toBeTruthy();
    expect((toolsArrayMatch![1].match(/\bremoteTool\b/g) ?? []).length).toBe(1);

    // The host serve-local target has the remote serve-local dep exactly once
    const host = JSON.parse(tree.read('apps/ts-host/project.json', 'utf-8')!);
    expect(host.targets['host-serve-local'].dependsOn).toEqual([
      { projects: ['@test/ts-remote'], target: 'remote-serve-local' },
    ]);
  });

  it('should transform a block-body arrow function, preserving existing statements', async () => {
    setupProjects();
    tree.write(
      'apps/ts-host/src/host/agent.ts',
      `import { Agent, tool } from '@strands-agents/sdk';
import { z } from 'zod';

const multiply = tool({
  name: 'Multiply',
  description: 'Multiply two numbers',
  inputSchema: z.object({ a: z.number(), b: z.number() }),
  callback: ({ a, b }) => a * b,
});

export const getAgent = async (sessionId: string) => {
  console.log('Creating agent');
  return new Agent({
    systemPrompt: 'You are a mathematical wizard.',
    tools: [multiply],
  });
};
`,
    );

    await tsAgentA2aConnectionGenerator(tree, {
      sourceProject: '@test/ts-host',
      targetProject: '@test/ts-remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });

    const agent = tree.read('apps/ts-host/src/host/agent.ts', 'utf-8')!;
    expect(agent).toContain("console.log('Creating agent')");
    expect(agent).toContain('RemoteClientStrands.create()');
    // Tool creation must come before new Agent()
    const clientIdx = agent.indexOf('RemoteClientStrands.create');
    const newAgentIdx = agent.indexOf('new Agent(');
    expect(clientIdx).toBeLessThan(newAgentIdx);
  });

  it('should append remote to existing tools without dropping prior entries', async () => {
    setupProjects();
    tree.write(
      'apps/ts-host/src/host/agent.ts',
      `import { Agent, tool } from '@strands-agents/sdk';
import { z } from 'zod';

const multiply = tool({ name: 'Multiply', inputSchema: z.object({}), callback: () => 0 });
const divide = tool({ name: 'Divide', inputSchema: z.object({}), callback: () => 0 });

export const getAgent = async (sessionId: string) =>
  new Agent({
    systemPrompt: '...',
    tools: [multiply, divide],
  });
`,
    );

    await tsAgentA2aConnectionGenerator(tree, {
      sourceProject: '@test/ts-host',
      targetProject: '@test/ts-remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });

    const agent = tree.read('apps/ts-host/src/host/agent.ts', 'utf-8')!;
    expect(agent).toMatch(/tools: \[multiply, divide, remoteTool\]/);
  });

  it('should match snapshot for agent-connection src files', async () => {
    setupProjects();
    await tsAgentA2aConnectionGenerator(tree, {
      sourceProject: '@test/ts-host',
      targetProject: '@test/ts-remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });

    const base = 'packages/common/agent-connection/src';
    const snap = (path: string, name: string) =>
      expect(tree.read(`${base}/${path}`, 'utf-8')).toMatchSnapshot(name);

    // Layer 2 (Strands wrapper) -> Layer 1 (client config) -> Layer 0 (fetch)
    snap(
      'core/agentcore-a2a-client-strands.ts',
      'agentcore-a2a-client-strands.ts',
    );
    snap(
      'core/agentcore-a2a-client-config.ts',
      'agentcore-a2a-client-config.ts',
    );
    snap('core/agentcore-fetch.ts', 'agentcore-fetch.ts');
    // Per-connection client + barrel
    snap('app/remote-client.ts', 'remote-client.ts');
    snap('index.ts', 'agent-connection-index.ts');
  });
});
