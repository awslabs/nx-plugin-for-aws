/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import {
  PY_AGENT_GENERATOR_INFO,
  pyAgentGenerator,
} from '../../../py/agent/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const PROJECT_ROOT = 'apps/test-project';
const AGENT_DIR = `${PROJECT_ROOT}/proj_test_project/agent`;
const AGENT_PY = `${AGENT_DIR}/agent.py`;
const MAIN_PY = `${AGENT_DIR}/main.py`;

type Protocol = 'http' | 'a2a' | 'ag-ui';

/** Register a py#agent component as the generator records it. */
const setUpProject = (
  tree: Tree,
  options: { protocol?: Protocol; framework?: 'strands' | 'langchain' } = {},
) => {
  addProjectConfiguration(tree, 'test-project', {
    root: PROJECT_ROOT,
    sourceRoot: `${PROJECT_ROOT}/proj_test_project`,
    targets: {},
    metadata: {
      components: [
        {
          generator: PY_AGENT_GENERATOR_INFO.id,
          path: 'proj_test_project/agent',
          protocol: options.protocol ?? 'http',
          framework: options.framework ?? 'strands',
          name: 'agent',
        },
      ],
    } as any,
  });
};

/** An HTTP agent.py as the generator wrote it before this change. */
const OLD_AGENT_PY = `from contextlib import contextmanager

from proj_agent_connection import log_model_errors, log_tool_errors
from strands import Agent, tool
from strands.hooks import HookCallback, HookProvider
from strands_tools import current_time

from .session import get_session_manager


@tool
def subtract(a: int, b: int) -> int:
    return a - b


AGENT_HOOKS: list[HookProvider | HookCallback] = [log_model_errors, log_tool_errors]


@contextmanager
def get_agent():
    yield Agent(
        name="Agent",
        description="Agent Strands Agent",
        system_prompt="""
You are a mathematical wizard.
Use your tools for mathematical tasks.
Refer to tools as your 'spellbook'.
""",
        tools=[subtract, current_time],
        hooks=AGENT_HOOKS,
        session_manager=get_session_manager(),
    )
`;

/** {@link OLD_AGENT_PY} after the migration. */
const NEW_AGENT_PY = `from contextlib import contextmanager
from datetime import UTC, datetime

from proj_agent_connection import log_model_errors, log_tool_errors
from strands import Agent, tool
from strands.hooks import HookCallback, HookProvider
from strands.plugins import Plugin
from strands.vended_plugins.context_injector import ContextInjector

from .session import get_session_manager


@tool
def subtract(a: int, b: int) -> int:
    return a - b


AGENT_HOOKS: list[HookProvider | HookCallback] = [log_model_errors, log_tool_errors]

# Gives the model the current time with each user message
AGENT_PLUGINS: list[Plugin] = [
    ContextInjector(
        lambda _: f"<current_time>{datetime.now(UTC).isoformat()}</current_time>"
    ),
]


@contextmanager
def get_agent():
    yield Agent(
        name="Agent",
        description="Agent Strands Agent",
        system_prompt="""
You are a mathematical wizard.
Use your tools for mathematical tasks.
Refer to tools as your 'spellbook'.
""",
        tools=[subtract],
        hooks=AGENT_HOOKS,
        plugins=AGENT_PLUGINS,
        session_manager=get_session_manager(),
    )
`;

/**
 * Roll a freshly generated agent back to the shape the generator wrote before
 * this change.
 */
const rollBackAgentPy = (vended: string): string =>
  vended
    .replace('from datetime import UTC, datetime\n', '')
    .replace(
      'from strands.plugins import Plugin\nfrom strands.vended_plugins.context_injector import ContextInjector\n',
      'from strands_tools import current_time\n',
    )
    .replace(/\n# Gives the model the current time[\s\S]*?\n\]\n/, '')
    .replace('tools=[subtract]', 'tools=[subtract, current_time]')
    .replace('        plugins=AGENT_PLUGINS,\n', '');

const rollBackAgUiMainPy = (vended: string): string =>
  vended
    .replace(
      'from .agent import AGENT_HOOKS, AGENT_PLUGINS, get_agent',
      'from .agent import AGENT_HOOKS, get_agent',
    )
    .replace(
      '            # AG-UI does not copy plugins from the template Agent either.\n            plugins=AGENT_PLUGINS,\n',
      '',
    );

/** Generate a py#agent into a Python project, as a user workspace would hold. */
const generateAgent = async (tree: Tree, protocol: Protocol) => {
  addProjectConfiguration(tree, 'test-project', {
    root: PROJECT_ROOT,
    sourceRoot: `${PROJECT_ROOT}/proj_test_project`,
    targets: {},
  });
  tree.write(
    `${PROJECT_ROOT}/pyproject.toml`,
    `[project]
name = "proj.test_project"
version = "0.1.0"
dependencies = []

[dependency-groups]
dev = []

[tool.uv]
dev-dependencies = []
`,
  );
  await pyAgentGenerator(tree, {
    project: 'test-project',
    name: 'agent',
    protocol,
    iac: 'cdk',
  } as any);
};

describe('py-agent-current-time-context-injector migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should replace the current_time tool with the ContextInjector plugin', async () => {
    setUpProject(tree);
    tree.write(AGENT_PY, OLD_AGENT_PY);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(AGENT_PY, 'utf-8')).toBe(NEW_AGENT_PY);
  });

  it('should be idempotent on re-run', async () => {
    setUpProject(tree);
    tree.write(AGENT_PY, OLD_AGENT_PY);

    await migration(tree);
    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(AGENT_PY, 'utf-8')).toBe(NEW_AGENT_PY);
  });

  it('should rewrite an agent.py an MCP connection generator has transformed', async () => {
    setUpProject(tree);
    tree.write(
      AGENT_PY,
      OLD_AGENT_PY.replace(
        'from proj_agent_connection import log_model_errors, log_tool_errors',
        'from proj_agent_connection import InventoryMcpClientStrands, log_model_errors, log_tool_errors',
      ).replace(
        'tools=[subtract, current_time],',
        'tools=[subtract, current_time, *inventory_mcp.list_tools_sync()],',
      ),
    );

    const { nextSteps } = await migration(tree);
    const agent = tree.read(AGENT_PY, 'utf-8')!;

    expect(nextSteps).toEqual([]);
    expect(agent).toContain(
      'tools=[subtract, *inventory_mcp.list_tools_sync()],',
    );
    expect(agent).toContain('plugins=AGENT_PLUGINS,');
    expect(agent).not.toContain('current_time,');
    expect(agent).not.toContain('strands_tools');
  });

  it.each<Protocol>(['http', 'a2a', 'ag-ui'])(
    'should converge a %s agent on exactly what the generator vends today',
    async (protocol) => {
      await generateAgent(tree, protocol);
      const vendedAgent = tree.read(AGENT_PY, 'utf-8')!;
      const vendedMain = tree.read(MAIN_PY, 'utf-8')!;

      const oldAgent = rollBackAgentPy(vendedAgent);
      expect(oldAgent).toContain('from strands_tools import current_time\n');
      expect(oldAgent).toContain('tools=[subtract, current_time]');
      expect(oldAgent).not.toContain('AGENT_PLUGINS');
      tree.write(AGENT_PY, oldAgent);
      if (protocol === 'ag-ui') {
        const oldMain = rollBackAgUiMainPy(vendedMain);
        expect(oldMain).not.toContain('AGENT_PLUGINS');
        tree.write(MAIN_PY, oldMain);
      }

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toEqual([]);
      expect(tree.read(AGENT_PY, 'utf-8')).toBe(vendedAgent);
      expect(tree.read(MAIN_PY, 'utf-8')).toBe(vendedMain);
    },
  );

  it.each<Protocol>(['http', 'a2a', 'ag-ui'])(
    'should be a no-op on a freshly generated %s agent',
    async (protocol) => {
      await generateAgent(tree, protocol);
      const agent = tree.read(AGENT_PY, 'utf-8');
      const main = tree.read(MAIN_PY, 'utf-8');

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toEqual([]);
      expect(tree.read(AGENT_PY, 'utf-8')).toBe(agent);
      expect(tree.read(MAIN_PY, 'utf-8')).toBe(main);
    },
  );

  it('should leave a hand-edited agent.py unchanged and list it in nextSteps', async () => {
    setUpProject(tree);
    // current_time is also called directly, so it is used outside the tools list.
    const edited = OLD_AGENT_PY.replace(
      '@tool\ndef subtract',
      '@tool\ndef today() -> str:\n    return current_time()[:10]\n\n\n@tool\ndef subtract',
    );
    tree.write(AGENT_PY, edited);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain(AGENT_PY);
    expect(nextSteps[0]).toContain('ContextInjector');
    expect(tree.read(AGENT_PY, 'utf-8')).toBe(edited);
  });

  it('should leave an agent.py importing other strands_tools unchanged and list it', async () => {
    setUpProject(tree);
    const edited = OLD_AGENT_PY.replace(
      'from strands_tools import current_time',
      'from strands_tools import current_time, http_request',
    ).replace(
      'tools=[subtract, current_time]',
      'tools=[subtract, current_time, http_request]',
    );
    tree.write(AGENT_PY, edited);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain(AGENT_PY);
    expect(tree.read(AGENT_PY, 'utf-8')).toBe(edited);
  });

  it('should leave an agent.py that already passes plugins unchanged and list it', async () => {
    setUpProject(tree);
    const edited = OLD_AGENT_PY.replace(
      '        hooks=AGENT_HOOKS,\n',
      '        hooks=AGENT_HOOKS,\n        plugins=[MyPlugin()],\n',
    );
    tree.write(AGENT_PY, edited);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(1);
    expect(tree.read(AGENT_PY, 'utf-8')).toBe(edited);
  });

  it('should leave an AG-UI agent unchanged when main.py no longer passes AGENT_HOOKS', async () => {
    setUpProject(tree, { protocol: 'ag-ui' });
    const agentPy = OLD_AGENT_PY.replace(
      '\nfrom .session import get_session_manager\n',
      '',
    ).replace('        session_manager=get_session_manager(),\n', '');
    const mainPy = `from ag_ui_strands import StrandsAgent

from .agent import get_agent

with get_agent() as agent:
    agui_agent = StrandsAgent(agent=agent, name="Agent")
`;
    tree.write(AGENT_PY, agentPy);
    tree.write(MAIN_PY, mainPy);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain(AGENT_PY);
    expect(tree.read(AGENT_PY, 'utf-8')).toBe(agentPy);
    expect(tree.read(MAIN_PY, 'utf-8')).toBe(mainPy);
  });

  it('should list other Python files in the project that use current_time', async () => {
    setUpProject(tree);
    tree.write(AGENT_PY, OLD_AGENT_PY);
    const helper = `${PROJECT_ROOT}/proj_test_project/helpers/clock.py`;
    const helperContent =
      'from strands_tools import current_time\n\nNOW = current_time\n';
    tree.write(helper, helperContent);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain(helper);
    expect(tree.read(helper, 'utf-8')).toBe(helperContent);
    expect(tree.read(AGENT_PY, 'utf-8')).toBe(NEW_AGENT_PY);
  });

  it('should leave a LangChain agent alone', async () => {
    setUpProject(tree, { framework: 'langchain' });
    // Not a real LangChain agent: proves the framework check gates the rewrite.
    tree.write(AGENT_PY, OLD_AGENT_PY);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toHaveLength(1);
    expect(tree.read(AGENT_PY, 'utf-8')).toBe(OLD_AGENT_PY);
  });

  it('should be a no-op when no project uses current_time', async () => {
    setUpProject(tree);
    tree.write(AGENT_PY, NEW_AGENT_PY);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(AGENT_PY, 'utf-8')).toBe(NEW_AGENT_PY);
  });

  it.each(['strands-agents-tools==0.8.11', 'Strands_Agents_Tools>=0.8,<0.9'])(
    'should keep %s in pyproject.toml and add a next step about it',
    async (requirement) => {
      setUpProject(tree);
      tree.write(AGENT_PY, OLD_AGENT_PY);
      const pyproject = `${PROJECT_ROOT}/pyproject.toml`;
      const pyprojectContent = `[project]
name = "proj.test_project"
version = "0.1.0"
dependencies = ["strands-agents==1.20.0", "${requirement}"]
`;
      tree.write(pyproject, pyprojectContent);

      const { nextSteps } = await migration(tree);

      expect(nextSteps).toEqual([
        `${pyproject}: it lists strands-agents-tools, which the py#agent generator no longer adds. strands-agents-tools 0.9.0 is a tombstone release (importing any of its tools raises ImportError); keep it pinned below 0.9 or remove it if unused.`,
      ]);
      expect(tree.read(pyproject, 'utf-8')).toBe(pyprojectContent);
      expect(tree.read(AGENT_PY, 'utf-8')).toBe(NEW_AGENT_PY);
    },
  );

  it('should not add the strands-agents-tools next step outside py#agent projects', async () => {
    addProjectConfiguration(tree, 'other', { root: 'apps/other' });
    tree.write(
      'apps/other/pyproject.toml',
      `[project]
name = "other"
version = "0.1.0"
dependencies = ["strands-agents-tools==0.8.11"]
`,
    );

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
  });

  it('should be a no-op in a workspace without any py#agent project', async () => {
    const other = 'apps/other/other/agent.py';
    addProjectConfiguration(tree, 'other', { root: 'apps/other' });
    tree.write(other, OLD_AGENT_PY);

    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.read(other, 'utf-8')).toBe(OLD_AGENT_PY);
  });
});
