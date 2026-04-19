/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import {
  pyStrandsAgentA2aConnectionGenerator,
  PY_STRANDS_AGENT_A2A_CONNECTION_GENERATOR_INFO,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { expectHasMetricTags } from '../../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';

describe('py#strands-agent#a2a-connection generator', () => {
  let tree: Tree;

  const HOST = {
    generator: 'py#strands-agent' as const,
    name: 'host',
    path: 'py_host/host',
    port: 8082,
    rc: 'Host',
    auth: 'IAM' as const,
    protocol: 'HTTP' as const,
  };

  const REMOTE = {
    generator: 'py#strands-agent' as const,
    name: 'remote',
    path: 'py_remote/remote',
    port: 9001,
    rc: 'Remote',
    auth: 'IAM' as const,
    protocol: 'A2A' as const,
  };

  const setupProjects = () => {
    // Set npm scope via root package.json
    tree.write('package.json', JSON.stringify({ name: '@test/source' }));

    // Create source python project
    tree.write(
      'apps/py-host/project.json',
      JSON.stringify({
        name: 'test.py_host',
        root: 'apps/py-host',
        sourceRoot: 'apps/py-host/py_host',
        targets: {
          'host-serve-local': {
            executor: 'nx:run-commands',
            options: {
              commands: ['echo serve-local'],
              env: { SERVE_LOCAL: 'true' },
            },
            dependsOn: [],
            continuous: true,
          },
        },
        metadata: { components: [HOST] },
      }),
    );

    tree.write(
      'apps/py-host/py_host/host/agent.py',
      `from contextlib import contextmanager

from strands import Agent, tool
from strands_tools import current_time


# Define a custom tool
@tool
def subtract(a: int, b: int) -> int:
    return a - b


@contextmanager
def get_agent(session_id: str):
    yield Agent(
        name="Host",
        description="Host Strands Agent",
        system_prompt="""
You are a mathematical wizard.
Use your tools for mathematical tasks.
Refer to tools as your 'spellbook'.
""",
        tools=[subtract, current_time],
    )
`,
    );

    tree.write(
      'apps/py-host/pyproject.toml',
      `[project]
name = "test.py_host"
version = "1.0.0"
dependencies = ["strands-agents"]
`,
    );

    // Create target python project
    tree.write(
      'apps/py-remote/project.json',
      JSON.stringify({
        name: 'test.py_remote',
        root: 'apps/py-remote',
        sourceRoot: 'apps/py-remote/py_remote',
        targets: {
          'remote-serve-local': {
            executor: 'nx:run-commands',
            options: {
              commands: ['echo serve-local'],
              env: { SERVE_LOCAL: 'true', PORT: '9001' },
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
    await pyStrandsAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });

    // agent-connection project created with core A2A client
    expect(tree.exists('packages/common/agent_connection/project.json')).toBe(
      true,
    );
    const coreFiles = tree
      .listChanges()
      .map((c) => c.path)
      .filter((p) => p.includes('agent_connection/') && p.includes('core/'));
    const corePath = coreFiles.find((p) =>
      p.endsWith('agentcore_a2a_client.py'),
    );
    expect(corePath).toBeDefined();

    // Per-connection client vended
    const clientPath =
      coreFiles[0]?.replace(/core\/.*/, '') + 'app/remote_client.py';
    // Find it properly
    const clientFile = tree
      .listChanges()
      .map((c) => c.path)
      .find((p) => p.endsWith('app/remote_client.py'));
    expect(clientFile).toBeDefined();
    const client = tree.read(clientFile!, 'utf-8')!;
    expect(client).toContain('RemoteClient');
    expect(client).toContain('SERVE_LOCAL');
    expect(client).toContain('http://localhost:9001/');
    expect(client).toContain('AgentCoreA2aClient.with_iam_auth');
  });

  it('should transform agent.py to wire the remote as a tool', async () => {
    setupProjects();
    await pyStrandsAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });

    const agent = tree.read('apps/py-host/py_host/host/agent.py', 'utf-8')!;
    expect(agent).toContain('RemoteClient');
    expect(agent).toContain('RemoteClient.create(session_id=session_id)');
    expect(agent).toContain('def ask_remote(prompt: str)');
    // A2AAgent is directly callable (syncs over invoke_async internally)
    expect(agent).toContain('str(remote(prompt))');
    expect(agent).toContain('ask_remote');
  });

  it('should make host serve-local depend on remote serve-local', async () => {
    setupProjects();
    await pyStrandsAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });

    const host = JSON.parse(tree.read('apps/py-host/project.json', 'utf-8')!);
    expect(host.targets['host-serve-local'].dependsOn).toEqual([
      { projects: ['test.py_remote'], target: 'remote-serve-local' },
    ]);
  });

  it('should throw when target is not an A2A agent', async () => {
    setupProjects();
    await expect(
      pyStrandsAgentA2aConnectionGenerator(tree, {
        sourceProject: 'test.py_host',
        targetProject: 'test.py_remote',
        sourceComponent: HOST,
        targetComponent: { ...REMOTE, protocol: 'HTTP' },
      }),
    ).rejects.toThrow(/A2A/);
  });

  it('should throw when target agent uses non-IAM auth', async () => {
    setupProjects();
    await expect(
      pyStrandsAgentA2aConnectionGenerator(tree, {
        sourceProject: 'test.py_host',
        targetProject: 'test.py_remote',
        sourceComponent: HOST,
        targetComponent: { ...REMOTE, auth: 'Cognito' },
      }),
    ).rejects.toThrow(/IAM/);
  });

  it('should add generator metric', async () => {
    setupProjects();
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });
    await pyStrandsAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });
    expectHasMetricTags(
      tree,
      PY_STRANDS_AGENT_A2A_CONNECTION_GENERATOR_INFO.metric,
    );
  });

  // --- AST transform edge cases ---

  it('should not duplicate `tool` when already imported from strands', async () => {
    setupProjects();
    await pyStrandsAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });
    const agent = tree.read('apps/py-host/py_host/host/agent.py', 'utf-8')!;
    const strandsImports = agent.match(/from strands import /g) ?? [];
    expect(strandsImports).toHaveLength(1);
    // Exactly one `tool` identifier in the import line
    const importLine = agent
      .split('\n')
      .find((l) => l.startsWith('from strands import'));
    expect(importLine).toBeDefined();
    expect((importLine!.match(/\btool\b/g) ?? []).length).toBe(1);
  });

  it('should not duplicate the client class import if already present', async () => {
    setupProjects();
    await pyStrandsAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });
    const agent = tree.read('apps/py-host/py_host/host/agent.py', 'utf-8')!;
    expect((agent.match(/\bRemoteClient\b/g) ?? []).length).toBeGreaterThan(0);
    // import line appears exactly once
    const importLines = agent
      .split('\n')
      .filter((l) => l.startsWith('from') && l.includes('RemoteClient'));
    expect(importLines).toHaveLength(1);
  });

  it('should not match unrelated `tools=` keyword arguments in the same file', async () => {
    setupProjects();
    tree.write(
      'apps/py-host/py_host/host/agent.py',
      `from contextlib import contextmanager

from strands import Agent, tool
from strands_tools import current_time


def some_unrelated_helper(tools=[]):
    # Unrelated function that happens to have a \`tools\` kwarg — must not be touched.
    return tools


@tool
def subtract(a: int, b: int) -> int:
    return a - b


@contextmanager
def get_agent(session_id: str):
    yield Agent(
        name="Host",
        description="Host Strands Agent",
        system_prompt="...",
        tools=[subtract, current_time],
    )
`,
    );

    await pyStrandsAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });

    const agent = tree.read('apps/py-host/py_host/host/agent.py', 'utf-8')!;
    // The unrelated helper's signature is unchanged
    expect(agent).toContain('def some_unrelated_helper(tools=[]):');
    // Agent's tools list now contains ask_remote
    expect(agent).toMatch(/tools=\[subtract, current_time, ask_remote\]/);
  });

  it('should be idempotent — re-running the generator does not duplicate the tool', async () => {
    setupProjects();
    await pyStrandsAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });
    await pyStrandsAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });
    const agent = tree.read('apps/py-host/py_host/host/agent.py', 'utf-8')!;
    // Client creation appears exactly once
    expect((agent.match(/RemoteClient\.create/g) ?? []).length).toBe(1);
    // The tool function is defined exactly once
    expect((agent.match(/def ask_remote\(/g) ?? []).length).toBe(1);
    // ask_remote appears in the tools list exactly once
    const toolsListMatch = agent.match(/tools=\[([^\]]*)\]/);
    expect(toolsListMatch).toBeTruthy();
    expect((toolsListMatch![1].match(/\bask_remote\b/g) ?? []).length).toBe(1);
  });

  it('should append to existing tools without dropping prior entries', async () => {
    setupProjects();
    tree.write(
      'apps/py-host/py_host/host/agent.py',
      `from contextlib import contextmanager

from strands import Agent, tool
from strands_tools import current_time


@tool
def subtract(a: int, b: int) -> int:
    return a - b


@tool
def divide(a: int, b: int) -> float:
    return a / b


@contextmanager
def get_agent(session_id: str):
    yield Agent(
        name="Host",
        system_prompt="...",
        tools=[subtract, divide, current_time],
    )
`,
    );

    await pyStrandsAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });

    const agent = tree.read('apps/py-host/py_host/host/agent.py', 'utf-8')!;
    expect(agent).toMatch(
      /tools=\[subtract, divide, current_time, ask_remote\]/,
    );
  });

  it('should not match `tools` inside a non-Agent call', async () => {
    setupProjects();
    tree.write(
      'apps/py-host/py_host/host/agent.py',
      `from contextlib import contextmanager

from strands import Agent, tool


# A completely unrelated constructor that happens to accept a tools= kwarg.
class SomethingElse:
    def __init__(self, tools):
        self.tools = tools


_other = SomethingElse(tools=[])


@contextmanager
def get_agent(session_id: str):
    yield Agent(
        system_prompt="...",
        tools=[],
    )
`,
    );

    await pyStrandsAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });

    const agent = tree.read('apps/py-host/py_host/host/agent.py', 'utf-8')!;
    // The unrelated class and call must be untouched
    expect(agent).toContain('class SomethingElse:');
    expect(agent).toContain('_other = SomethingElse(tools=[])');
    // The Agent call got the new tool
    expect(agent).toMatch(/yield Agent\([\s\S]*tools=\[ask_remote\]/);
  });
});
