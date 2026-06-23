/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { expectHasMetricTags } from '../../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import {
  PY_AGENT_A2A_CONNECTION_GENERATOR_INFO,
  pyAgentA2aConnectionGenerator,
} from './generator';

describe('py#agent#a2a-connection generator', () => {
  let tree: Tree;

  const HOST = {
    generator: 'py#agent' as const,
    name: 'host',
    path: 'py_host/host',
    port: 8082,
    rc: 'Host',
    auth: 'iam' as const,
    protocol: 'http' as const,
  };

  const REMOTE = {
    generator: 'py#agent' as const,
    name: 'remote',
    path: 'py_remote/remote',
    port: 9001,
    rc: 'Remote',
    auth: 'iam' as const,
    protocol: 'a2a' as const,
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
    await pyAgentA2aConnectionGenerator(tree, {
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
      p.endsWith('agentcore_a2a_client_strands.py'),
    );
    expect(corePath).toBeDefined();
    // Layer 1 (framework-agnostic client config) + Layer 0 (shared auth)
    expect(
      coreFiles.find((p) => p.endsWith('agentcore_a2a_client_config.py')),
    ).toBeDefined();
    expect(
      coreFiles.find((p) => p.endsWith('core/auth/session.py')),
    ).toBeDefined();

    // Per-connection client vended
    const clientPath =
      coreFiles[0]?.replace(/core\/.*/, '') + 'app/remote_client_strands.py';
    // Find it properly
    const clientFile = tree
      .listChanges()
      .map((c) => c.path)
      .find((p) => p.endsWith('app/remote_client_strands.py'));
    expect(clientFile).toBeDefined();
    const client = tree.read(clientFile!, 'utf-8')!;
    expect(client).toContain('RemoteClientStrands');
    expect(client).toContain('SERVE_LOCAL');
    expect(client).toContain('http://localhost:9001/');
    expect(client).toContain('AgentCoreA2aClientStrands.with_iam_auth');
  });

  it('should transform agent.py to wire the remote as a tool', async () => {
    setupProjects();
    await pyAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });

    const agent = tree.read('apps/py-host/py_host/host/agent.py', 'utf-8')!;
    expect(agent).toContain('RemoteClientStrands');
    expect(agent).toContain('RemoteClientStrands.create()');
    expect(agent).toContain('def ask_remote(prompt: str)');
    // A2AAgent is directly callable (syncs over invoke_async internally)
    expect(agent).toContain('str(remote(prompt))');
    expect(agent).toContain('ask_remote');
  });

  it('should make host serve-local depend on remote serve-local', async () => {
    setupProjects();
    await pyAgentA2aConnectionGenerator(tree, {
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
      pyAgentA2aConnectionGenerator(tree, {
        sourceProject: 'test.py_host',
        targetProject: 'test.py_remote',
        sourceComponent: HOST,
        targetComponent: { ...REMOTE, protocol: 'http' },
      }),
    ).rejects.toThrow(/A2A/);
  });

  it('should throw when target agent uses non-IAM auth', async () => {
    setupProjects();
    await expect(
      pyAgentA2aConnectionGenerator(tree, {
        sourceProject: 'test.py_host',
        targetProject: 'test.py_remote',
        sourceComponent: HOST,
        targetComponent: { ...REMOTE, auth: 'cognito' },
      }),
    ).rejects.toThrow(/IAM/);
  });

  it('should add generator metric', async () => {
    setupProjects();
    await sharedConstructsGenerator(tree, { iac: 'cdk' });
    await pyAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });
    expectHasMetricTags(tree, PY_AGENT_A2A_CONNECTION_GENERATOR_INFO.metric);
  });

  // --- AST transform edge cases ---

  it('should not duplicate `tool` when already imported from strands', async () => {
    setupProjects();
    await pyAgentA2aConnectionGenerator(tree, {
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
    await pyAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });
    const agent = tree.read('apps/py-host/py_host/host/agent.py', 'utf-8')!;
    expect(
      (agent.match(/\bRemoteClientStrands\b/g) ?? []).length,
    ).toBeGreaterThan(0);
    // import line appears exactly once
    const importLines = agent
      .split('\n')
      .filter((l) => l.startsWith('from') && l.includes('RemoteClientStrands'));
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

    await pyAgentA2aConnectionGenerator(tree, {
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
    await pyAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });
    await pyAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });
    const agent = tree.read('apps/py-host/py_host/host/agent.py', 'utf-8')!;
    // Client creation appears exactly once
    expect((agent.match(/RemoteClientStrands\.create/g) ?? []).length).toBe(1);
    // The tool function is defined exactly once
    expect((agent.match(/def ask_remote\(/g) ?? []).length).toBe(1);
    // ask_remote appears in the tools list exactly once
    const toolsListMatch = agent.match(/tools=\[([^\]]*)\]/);
    expect(toolsListMatch).toBeTruthy();
    expect((toolsListMatch![1].match(/\bask_remote\b/g) ?? []).length).toBe(1);

    // The host serve-local target has the remote serve-local dep exactly once
    const host = JSON.parse(tree.read('apps/py-host/project.json', 'utf-8')!);
    expect(host.targets['host-serve-local'].dependsOn).toEqual([
      { projects: ['test.py_remote'], target: 'remote-serve-local' },
    ]);
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

    await pyAgentA2aConnectionGenerator(tree, {
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

    await pyAgentA2aConnectionGenerator(tree, {
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

  it('should match snapshot for agent-connection core files', async () => {
    setupProjects();
    await pyAgentA2aConnectionGenerator(tree, {
      sourceProject: 'test.py_host',
      targetProject: 'test.py_remote',
      sourceComponent: HOST,
      targetComponent: REMOTE,
    });

    const moduleDirs = tree.children('packages/common/agent_connection');
    const moduleName = moduleDirs.find((c) => c.includes('agent_connection'))!;
    const base = `packages/common/agent_connection/${moduleName}`;
    const snap = (path: string, name: string) =>
      expect(tree.read(`${base}/${path}`, 'utf-8')).toMatchSnapshot(name);

    // Layer 2 (Strands wrapper) -> Layer 1 (client config) -> Layer 0 (auth)
    snap(
      'core/agentcore_a2a_client_strands.py',
      'agentcore_a2a_client_strands.py',
    );
    snap(
      'core/agentcore_a2a_client_config.py',
      'agentcore_a2a_client_config.py',
    );
    snap('core/auth/session.py', 'session.py');
    // Per-connection client
    snap('app/remote_client_strands.py', 'remote_client_strands.py');
  });

  // --- LangChain source agent ---

  describe('langchain source agent', () => {
    const LANGCHAIN_HOST = {
      ...HOST,
      framework: 'langchain' as const,
      protocol: 'ag-ui' as const,
    };

    const setupLangchainHost = () => {
      setupProjects();
      // Replace the host's metadata + agent.py with a langchain agent built from
      // create_agent (the langchain agent generator's shape).
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
          metadata: { components: [LANGCHAIN_HOST] },
        }),
      );
      tree.write(
        'apps/py-host/py_host/host/agent.py',
        `import os

from langchain.agents import create_agent
from langchain_aws import ChatBedrockConverse
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver

REGION = os.environ.get("AWS_REGION", "us-east-1")
MODEL_ID = os.environ.get("MODEL_ID", "global.anthropic.claude-haiku-4-5-20251001-v1:0")


@tool
def subtract(a: int, b: int) -> int:
    """Subtract b from a."""
    return a - b


def get_agent():
    model = ChatBedrockConverse(model=MODEL_ID, region_name=REGION)
    return create_agent(
        model=model,
        tools=[subtract],
        system_prompt="You are a mathematical wizard.",
        checkpointer=InMemorySaver(),
    )
`,
      );
    };

    it('should wire the remote as a tool into create_agent', async () => {
      setupLangchainHost();
      await pyAgentA2aConnectionGenerator(tree, {
        sourceProject: 'test.py_host',
        targetProject: 'test.py_remote',
        sourceComponent: LANGCHAIN_HOST,
        targetComponent: REMOTE,
      });

      const agent = tree.read('apps/py-host/py_host/host/agent.py', 'utf-8')!;
      // tool comes from langchain_core.tools, not strands
      expect(agent).toContain('from langchain_core.tools import tool');
      expect(agent).not.toContain('from strands import');
      expect(agent).toContain('RemoteClientStrands.create()');
      expect(agent).toContain('def ask_remote(prompt: str)');
      expect(agent).toContain('str(remote(prompt))');
      // Spread into create_agent's tools list
      expect(agent).toMatch(/tools=\[subtract, ask_remote\]/);
    });

    it('should be idempotent for langchain agents', async () => {
      setupLangchainHost();
      await pyAgentA2aConnectionGenerator(tree, {
        sourceProject: 'test.py_host',
        targetProject: 'test.py_remote',
        sourceComponent: LANGCHAIN_HOST,
        targetComponent: REMOTE,
      });
      await pyAgentA2aConnectionGenerator(tree, {
        sourceProject: 'test.py_host',
        targetProject: 'test.py_remote',
        sourceComponent: LANGCHAIN_HOST,
        targetComponent: REMOTE,
      });
      const agent = tree.read('apps/py-host/py_host/host/agent.py', 'utf-8')!;
      expect((agent.match(/RemoteClientStrands\.create/g) ?? []).length).toBe(
        1,
      );
      expect((agent.match(/def ask_remote\(/g) ?? []).length).toBe(1);
      const toolsListMatch = agent.match(/tools=\[([^\]]*)\]/);
      expect(toolsListMatch).toBeTruthy();
      expect((toolsListMatch![1].match(/\bask_remote\b/g) ?? []).length).toBe(
        1,
      );
    });

    it('should not match unrelated tools= kwargs (scoped to create_agent)', async () => {
      setupLangchainHost();
      tree.write(
        'apps/py-host/py_host/host/agent.py',
        `import os

from langchain.agents import create_agent
from langchain_aws import ChatBedrockConverse
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver


def some_unrelated_helper(tools=[]):
    return tools


@tool
def subtract(a: int, b: int) -> int:
    """Subtract b from a."""
    return a - b


def get_agent():
    model = ChatBedrockConverse(model="m", region_name="us-east-1")
    return create_agent(
        model=model,
        tools=[subtract],
        system_prompt="...",
        checkpointer=InMemorySaver(),
    )
`,
      );

      await pyAgentA2aConnectionGenerator(tree, {
        sourceProject: 'test.py_host',
        targetProject: 'test.py_remote',
        sourceComponent: LANGCHAIN_HOST,
        targetComponent: REMOTE,
      });

      const agent = tree.read('apps/py-host/py_host/host/agent.py', 'utf-8')!;
      // The unrelated helper's signature is unchanged
      expect(agent).toContain('def some_unrelated_helper(tools=[]):');
      // Only create_agent's tools list got the tool
      expect(agent).toMatch(/tools=\[subtract, ask_remote\]/);
    });
  });
});
