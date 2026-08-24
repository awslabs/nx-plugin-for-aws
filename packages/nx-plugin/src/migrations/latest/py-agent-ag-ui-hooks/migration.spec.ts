/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { PY_AGENT_GENERATOR_INFO } from '../../../py/agent/generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

const PROJECT_ROOT = 'apps/test-project';
const AGENT_DIR = `${PROJECT_ROOT}/proj_test_project/agent`;
const AGENT_PY = `${AGENT_DIR}/agent.py`;
const MAIN_PY = `${AGENT_DIR}/main.py`;

const setUpProject = (
  tree: Tree,
  options: {
    path?: string;
    protocol?: 'http' | 'a2a' | 'ag-ui';
    framework?: 'strands' | 'langchain';
  } = {},
) => {
  addProjectConfiguration(tree, 'test-project', {
    root: PROJECT_ROOT,
    sourceRoot: `${PROJECT_ROOT}/proj_test_project`,
    targets: {},
    metadata: {
      components: [
        {
          generator: PY_AGENT_GENERATOR_INFO.id,
          path: options.path ?? 'proj_test_project/agent',
          protocol: options.protocol ?? 'ag-ui',
          framework: options.framework ?? 'strands',
          name: 'agent',
          rc: 'SnapshotAgent',
        },
      ],
    } as any,
  });
};

const OLD_AGUI_AGENT_PY = `from contextlib import contextmanager

from strands import Agent, tool
from strands_tools import current_time
from proj_agent_connection import log_model_errors, log_tool_errors


@tool
def subtract(a: int, b: int) -> int:
    return a - b


@contextmanager
def get_agent():
    yield Agent(
        name="SnapshotAgent",
        description="SnapshotAgent Strands Agent",
        system_prompt="""
You are a mathematical wizard.
""",
        tools=[subtract, current_time],
        hooks=[log_model_errors, log_tool_errors],
    )
`;

const OLD_HTTP_AGENT_PY = `from contextlib import contextmanager

from strands import Agent, tool
from strands_tools import current_time
from proj_agent_connection import log_model_errors, log_tool_errors

from .session import get_session_manager


@tool
def subtract(a: int, b: int) -> int:
    return a - b


@contextmanager
def get_agent():
    yield Agent(
        name="SnapshotAgent",
        description="SnapshotAgent Strands Agent",
        system_prompt="""
You are a mathematical wizard.
""",
        tools=[subtract, current_time],
        hooks=[log_model_errors, log_tool_errors],
        session_manager=get_session_manager(),
    )
`;

const OLD_AGUI_MAIN_PY = `import logging
from contextlib import asynccontextmanager

from ag_ui_strands import StrandsAgent, StrandsAgentConfig
from fastapi import FastAPI

from .agent import get_agent
from .middleware.session_id_middleware import SessionIdMiddleware
from .session import get_session_manager

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    with get_agent() as agent:
        app.state.agui_agent = StrandsAgent(
            agent=agent,
            name="SnapshotAgent",
            description="A Strands Agent exposed via the AG-UI protocol.",
            # A per-thread session manager, not the template Agent's own, since
            # AG-UI caches one Strands agent per thread_id.
            config=StrandsAgentConfig(
                session_manager_provider=lambda _input_data: get_session_manager()
            ),
        )
        yield


app = FastAPI(title="AWS Strands - SnapshotAgent", lifespan=lifespan)
app.add_middleware(SessionIdMiddleware)


@app.get("/ping")
async def ping():
    return {"status": "healthy"}
`;

// A connection generator has wrapped the get_agent body in a `with` block and
// given it a parameter, so the hoist can't assume the vended body or signature.
const OLD_CONNECTED_AGUI_AGENT_PY = `from contextlib import contextmanager

from proj_agent_connection import (
    InventoryMcpClientStrands,
    log_model_errors,
    log_tool_errors,
)
from strands import Agent, tool
from strands_tools import current_time


@tool
def subtract(a: int, b: int) -> int:
    return a - b


@contextmanager
def get_agent(session_id: str):
    inventory_mcp = InventoryMcpClientStrands.create()
    with (
        inventory_mcp,
    ):
        yield Agent(
            name="SnapshotAgent",
            tools=[subtract, current_time, *inventory_mcp.list_tools_sync()],
            hooks=[log_model_errors, log_tool_errors],
        )
`;

const OLD_LANGCHAIN_AGENT_PY = `from langchain.agents import create_agent
from langchain_aws import ChatBedrockConverse
from langchain_core.tools import tool

from .session import get_checkpointer


@tool
def subtract(a: int, b: int) -> int:
    """Subtract b from a."""
    return a - b


def get_agent():
    return create_agent(
        model=ChatBedrockConverse(model="model-id", region_name="us-east-1"),
        tools=[subtract],
        checkpointer=get_checkpointer(),
    )
`;

describe('py-agent-ag-ui-hooks migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should do nothing when no projects contain Python agents', async () => {
    await expect(migration(tree)).resolves.toEqual({ nextSteps: [] });
  });

  describe('Strands AG-UI', () => {
    beforeEach(() => {
      tree.write(AGENT_PY, OLD_AGUI_AGENT_PY);
      tree.write(MAIN_PY, OLD_AGUI_MAIN_PY);
    });

    it('should hoist the hooks and forward them to the AG-UI adapter', async () => {
      setUpProject(tree);

      const result = await migration(tree);
      const agent = tree.read(AGENT_PY, 'utf-8') ?? '';
      const main = tree.read(MAIN_PY, 'utf-8') ?? '';

      expect(result.nextSteps).toEqual([]);
      expect(agent).toContain(
        'AGENT_HOOKS: list[HookProvider | HookCallback] = [log_model_errors, log_tool_errors]',
      );
      expect(agent).toContain('hooks=AGENT_HOOKS,');
      expect(agent).not.toContain('hooks=[log_model_errors, log_tool_errors]');

      expect(main).toContain('from .agent import AGENT_HOOKS, get_agent');
      expect(main).toContain('hooks=AGENT_HOOKS,');
      // The existing arguments, and the comment above them, are untouched.
      expect(main).toContain(
        'session_manager_provider=lambda _input_data: get_session_manager()',
      );
      expect(main).toContain('# AG-UI caches one Strands agent per thread_id.');
    });

    it('should carry a customised hooks list along', async () => {
      setUpProject(tree);
      tree.write(
        AGENT_PY,
        OLD_AGUI_AGENT_PY.replace(
          'hooks=[log_model_errors, log_tool_errors]',
          'hooks=[log_model_errors, log_tool_errors, MyHook()]',
        ),
      );

      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      expect(tree.read(AGENT_PY, 'utf-8')).toContain(
        'log_model_errors,\n    log_tool_errors,\n    MyHook(),\n]',
      );
      expect(tree.read(MAIN_PY, 'utf-8')).toContain('hooks=AGENT_HOOKS,');
    });

    it('should hoist an agent.py a connection generator has transformed', async () => {
      setUpProject(tree);
      tree.write(AGENT_PY, OLD_CONNECTED_AGUI_AGENT_PY);

      const result = await migration(tree);
      const agent = tree.read(AGENT_PY, 'utf-8') ?? '';

      expect(result.nextSteps).toEqual([]);
      expect(agent).toContain(
        'AGENT_HOOKS: list[HookProvider | HookCallback] = [log_model_errors, log_tool_errors]',
      );
      expect(agent).toContain('hooks=AGENT_HOOKS,');
      expect(agent).toContain('def get_agent(session_id: str):');
      expect(agent).toContain(
        'inventory_mcp = InventoryMcpClientStrands.create()',
      );
      expect(tree.read(MAIN_PY, 'utf-8')).toContain('hooks=AGENT_HOOKS,');
    });

    it('should support legacy component paths ending in agent.py', async () => {
      setUpProject(tree, { path: 'proj_test_project/agent/agent.py' });

      await migration(tree);

      expect(tree.read(AGENT_PY, 'utf-8')).toContain(
        'AGENT_HOOKS: list[HookProvider | HookCallback] = [',
      );
      expect(tree.read(MAIN_PY, 'utf-8')).toContain('hooks=AGENT_HOOKS,');
    });

    it('should complete the main.py half when agent.py is already hoisted', async () => {
      setUpProject(tree);
      tree.write(
        AGENT_PY,
        OLD_AGUI_AGENT_PY.replace(
          'hooks=[log_model_errors, log_tool_errors]',
          'hooks=AGENT_HOOKS',
        ).replace(
          '@contextmanager',
          'AGENT_HOOKS: list[HookProvider | HookCallback] = [log_model_errors, log_tool_errors]\n\n\n@contextmanager',
        ),
      );

      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      expect(tree.read(MAIN_PY, 'utf-8')).toContain(
        'from .agent import AGENT_HOOKS, get_agent',
      );
      expect(tree.read(MAIN_PY, 'utf-8')).toContain('hooks=AGENT_HOOKS,');
    });

    it('should report a diverged agent.py without partially rewriting it', async () => {
      setUpProject(tree);
      tree.write(
        AGENT_PY,
        OLD_AGUI_AGENT_PY.replace(
          'hooks=[log_model_errors, log_tool_errors],',
          'hooks=my_hooks(),',
        ),
      );

      const result = await migration(tree);

      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps[0]).toContain(AGENT_PY);
      expect(result.nextSteps[0]).toContain(MAIN_PY);
      expect(tree.read(AGENT_PY, 'utf-8')).toContain('hooks=my_hooks(),');
      expect(tree.read(AGENT_PY, 'utf-8')).not.toContain('AGENT_HOOKS');
      expect(tree.read(MAIN_PY, 'utf-8')).not.toContain('hooks=');
    });

    it('should report a diverged main.py without partially rewriting it', async () => {
      setUpProject(tree);
      tree.write(
        MAIN_PY,
        OLD_AGUI_MAIN_PY.replace(
          'StrandsAgent(\n            agent=agent,',
          'StrandsAgent(\n            **agui_kwargs,',
        ),
      );

      const result = await migration(tree);
      const main = tree.read(MAIN_PY, 'utf-8') ?? '';

      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps[0]).toContain(MAIN_PY);
      expect(main).toContain('**agui_kwargs,');
      expect(main).not.toContain('AGENT_HOOKS');
      // agent.py is still hoisted - it matches what the generator vends now.
      expect(tree.read(AGENT_PY, 'utf-8')).toContain(
        'AGENT_HOOKS: list[HookProvider | HookCallback] = [',
      );
    });

    it('should leave a main.py that already passes its own hooks alone', async () => {
      setUpProject(tree);
      tree.write(
        MAIN_PY,
        OLD_AGUI_MAIN_PY.replace(
          '            config=StrandsAgentConfig(',
          '            hooks=[MyHook()],\n            config=StrandsAgentConfig(',
        ),
      );

      const result = await migration(tree);
      const main = tree.read(MAIN_PY, 'utf-8') ?? '';

      expect(result.nextSteps).toEqual([]);
      expect(main).toContain('hooks=[MyHook()],');
      expect(main).not.toContain('AGENT_HOOKS');
    });

    it('should be idempotent', async () => {
      setUpProject(tree);

      await migration(tree);
      const once = {
        agent: tree.read(AGENT_PY, 'utf-8'),
        main: tree.read(MAIN_PY, 'utf-8'),
      };

      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      expect(tree.read(AGENT_PY, 'utf-8')).toEqual(once.agent);
      expect(tree.read(MAIN_PY, 'utf-8')).toEqual(once.main);
    });
  });

  describe('Strands HTTP', () => {
    beforeEach(() => {
      tree.write(AGENT_PY, OLD_HTTP_AGENT_PY);
    });

    it('should hoist the hooks to match what the generator vends', async () => {
      setUpProject(tree, { protocol: 'http' });

      const result = await migration(tree);
      const agent = tree.read(AGENT_PY, 'utf-8') ?? '';

      expect(result.nextSteps).toEqual([]);
      expect(agent).toContain(
        'AGENT_HOOKS: list[HookProvider | HookCallback] = [log_model_errors, log_tool_errors]',
      );
      expect(agent).toContain('hooks=AGENT_HOOKS,');
      expect(agent).toContain('session_manager=get_session_manager(),');
    });

    it('should not report a diverged agent.py, having nothing to forward', async () => {
      setUpProject(tree, { protocol: 'http' });
      tree.write(
        AGENT_PY,
        OLD_HTTP_AGENT_PY.replace(
          'hooks=[log_model_errors, log_tool_errors],',
          'hooks=my_hooks(),',
        ),
      );

      await expect(migration(tree)).resolves.toEqual({ nextSteps: [] });
      expect(tree.read(AGENT_PY, 'utf-8')).not.toContain('AGENT_HOOKS');
    });

    it('should be idempotent', async () => {
      setUpProject(tree, { protocol: 'http' });

      await migration(tree);
      const once = tree.read(AGENT_PY, 'utf-8');

      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      expect(tree.read(AGENT_PY, 'utf-8')).toEqual(once);
    });
  });

  describe('LangChain', () => {
    it('should leave LangChain agents untouched', async () => {
      setUpProject(tree, { framework: 'langchain', protocol: 'ag-ui' });
      tree.write(AGENT_PY, OLD_LANGCHAIN_AGENT_PY);

      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      expect(tree.read(AGENT_PY, 'utf-8')).toEqual(OLD_LANGCHAIN_AGENT_PY);
    });
  });
});
