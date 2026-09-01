/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { PY_AGENT_GENERATOR_INFO } from '../../../py/agent/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const PROJECT_ROOT = 'apps/test-project';
const AGENT_DIR = `${PROJECT_ROOT}/proj_test_project/agent`;

const OLD_STRANDS_MAIN = `import logging

from fastapi import FastAPI
from strands.multiagent.a2a import A2AServer
from proj_agent_connection import session_id_context, with_session_id

from .agent import get_agent

_agent_ctx = with_session_id(
    get_agent,
    name="SnapshotAgent",
    description="A Strands Agent exposed via the Agent-to-Agent (A2A) protocol.",
)
_agent = _agent_ctx.__enter__()

a2a_server = A2AServer(agent=_agent, port=9000)

app = FastAPI()

app.mount("/", a2a_server.to_fastapi_app())
`;

const OLD_LANGCHAIN_MAIN = `from fastapi import FastAPI

from .agent import get_agent

_graph = get_agent()


async def handle(context):
    result = await _graph.ainvoke(
        {"messages": [{"role": "user", "content": context.get_user_input()}]},
        {"configurable": {"thread_id": "abc"}},
    )
    return result


app = FastAPI(title="SnapshotAgent")
`;

const AC_DIR = 'packages/common/agent_connection/proj_agent_connection/core';
const WITH_SESSION_ID_PATH = `${AC_DIR}/with_session_id_strands.py`;
const SESSION_CONTEXT_PATH = `${AC_DIR}/session_context.py`;

const OLD_WITH_SESSION_ID = `from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, ExitStack, contextmanager
from typing import Any

from .session_context import get_current_session_id


@contextmanager
def with_session_id(
    agent_factory: Callable[[], AbstractContextManager[Any]],
    *,
    name: str,
    description: str,
) -> Iterator[Any]:
    """Wrap an agent factory so each session gets its own cached Agent."""
    stack = ExitStack()
    agents: dict[str, Any] = {}

    def _for_session() -> Any:
        sid = get_current_session_id() or "default"
        if sid not in agents:
            agents[sid] = stack.enter_context(agent_factory())
        return agents[sid]

    try:
        yield _for_session()
    finally:
        stack.close()
`;

const OLD_SESSION_CONTEXT = `from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

_session_id_var: ContextVar[str | None] = ContextVar(
    "agentcore_session_id", default=None
)


def get_current_session_id() -> str | None:
    """The session ID for the current async scope, or \`\`None\`\`."""
    return _session_id_var.get()


@contextmanager
def session_id_context(session_id: str) -> Iterator[None]:
    """Bind *session_id* as the current session for the scope of the block."""
    token = _session_id_var.set(session_id)
    try:
        yield
    finally:
        _session_id_var.reset(token)
`;

const setUpProject = (
  tree: Tree,
  options: {
    path?: string;
    protocol?: 'a2a' | 'http';
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
          protocol: options.protocol ?? 'a2a',
          framework: options.framework ?? 'strands',
          rc: 'SnapshotAgent',
        },
      ],
    } as any,
  });
};

describe('py-agent-a2a-lifespan-construction migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should do nothing when no projects contain Python agents', async () => {
    await expect(migration(tree)).resolves.toEqual({ nextSteps: [] });
  });

  describe('Strands A2A', () => {
    it('should migrate a Strands A2A agent to a lifespan-scoped agent factory', async () => {
      setUpProject(tree);
      tree.write(`${AGENT_DIR}/main.py`, OLD_STRANDS_MAIN);

      const result = await migration(tree);
      const migrated = tree.read(`${AGENT_DIR}/main.py`, 'utf-8') ?? '';

      expect(result.nextSteps).toEqual([]);
      expect(migrated).toContain('asynccontextmanager');
      expect(migrated).toContain('SimpleNamespace');
      expect(migrated).toContain('from typing import cast');
      expect(migrated).toContain('from strands import Agent');
      expect(migrated).toContain('AGENT_NAME = "SnapshotAgent"');
      expect(migrated).toContain(
        '_card_placeholder = cast(\n    Agent, SimpleNamespace(name=AGENT_NAME, description=AGENT_DESCRIPTION)\n)',
      );
      expect(migrated).toContain('async def lifespan(app: FastAPI):');
      expect(migrated).toContain('with_session_id(');
      expect(migrated).toContain('app.state.agent = agent');
      expect(migrated).toContain('app = FastAPI(lifespan=lifespan)');
      expect(migrated).toContain('a2a_server = A2AServer(');
      expect(migrated).toContain(
        'agent_factory=lambda _context_id: getattr(app.state, "agent", _card_placeholder)',
      );
      expect(migrated).toContain('port=9000');
      expect(migrated).not.toContain('agent=_agent');
      expect(migrated).not.toContain('_agent_ctx');
      expect(migrated).not.toContain('__enter__()');
    });

    it('should support legacy component paths ending in agent.py', async () => {
      setUpProject(tree, { path: 'proj_test_project/agent/agent.py' });
      tree.write(`${AGENT_DIR}/main.py`, OLD_STRANDS_MAIN);

      await migration(tree);

      expect(tree.read(`${AGENT_DIR}/main.py`, 'utf-8')).toContain(
        'agent_factory=lambda _context_id: getattr(app.state, "agent", _card_placeholder)',
      );
    });

    it('should report a diverged generated shape without partially rewriting it', async () => {
      setUpProject(tree);
      const diverged = OLD_STRANDS_MAIN.replace(
        'description="A Strands Agent exposed via the Agent-to-Agent (A2A) protocol.",',
        'description="Custom description",',
      );
      tree.write(`${AGENT_DIR}/main.py`, diverged);

      const result = await migration(tree);
      const contents = tree.read(`${AGENT_DIR}/main.py`, 'utf-8') ?? '';

      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps[0]).toContain(`${AGENT_DIR}/main.py`);
      expect(contents).toContain('_agent_ctx = with_session_id(');
      expect(contents).toContain('_agent = _agent_ctx.__enter__()');
      expect(contents).not.toContain('async def lifespan');
      expect(contents).not.toContain('asynccontextmanager');
    });

    it('should be idempotent', async () => {
      setUpProject(tree);
      tree.write(`${AGENT_DIR}/main.py`, OLD_STRANDS_MAIN);

      await migration(tree);
      const once = tree.read(`${AGENT_DIR}/main.py`, 'utf-8');
      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      expect(tree.read(`${AGENT_DIR}/main.py`, 'utf-8')).toEqual(once);
    });
  });

  describe('LangChain A2A', () => {
    it('should migrate a LangChain A2A agent to lifespan-scoped construction', async () => {
      setUpProject(tree, { framework: 'langchain' });
      tree.write(`${AGENT_DIR}/main.py`, OLD_LANGCHAIN_MAIN);

      const result = await migration(tree);
      const migrated = tree.read(`${AGENT_DIR}/main.py`, 'utf-8') ?? '';

      expect(result.nextSteps).toEqual([]);
      expect(migrated).toContain('asynccontextmanager');
      expect(migrated).toContain('async def lifespan(app: FastAPI):');
      expect(migrated).toContain('app.state.agent = get_agent()');
      expect(migrated).toContain('app.state.agent.ainvoke(');
      expect(migrated).toContain(
        'app = FastAPI(title="SnapshotAgent", lifespan=lifespan)',
      );
      expect(migrated).not.toContain('_graph');
    });

    it('should report a diverged generated shape without partially rewriting it', async () => {
      setUpProject(tree, { framework: 'langchain' });
      const diverged = OLD_LANGCHAIN_MAIN.replace(
        'app = FastAPI(title="SnapshotAgent")',
        'app = FastAPI(title="SnapshotAgent", debug=True)',
      );
      tree.write(`${AGENT_DIR}/main.py`, diverged);

      const result = await migration(tree);
      const contents = tree.read(`${AGENT_DIR}/main.py`, 'utf-8') ?? '';

      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps[0]).toContain(`${AGENT_DIR}/main.py`);
      expect(contents).toContain('_graph = get_agent()');
      expect(contents).not.toContain('async def lifespan');
    });

    it('should be idempotent', async () => {
      setUpProject(tree, { framework: 'langchain' });
      tree.write(`${AGENT_DIR}/main.py`, OLD_LANGCHAIN_MAIN);

      await migration(tree);
      const once = tree.read(`${AGENT_DIR}/main.py`, 'utf-8');
      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      expect(tree.read(`${AGENT_DIR}/main.py`, 'utf-8')).toEqual(once);
    });
  });

  it('should leave Strands HTTP agents untouched', async () => {
    setUpProject(tree, { protocol: 'http' });
    tree.write(`${AGENT_DIR}/main.py`, OLD_STRANDS_MAIN);

    const result = await migration(tree);
    const contents = tree.read(`${AGENT_DIR}/main.py`, 'utf-8') ?? '';

    expect(result.nextSteps).toEqual([]);
    expect(contents).toContain('_agent_ctx = with_session_id(');
    expect(contents).toContain('_agent = _agent_ctx.__enter__()');
    expect(contents).toContain('agent=_agent');
    expect(contents).not.toContain('async def lifespan');
  });

  describe('Iterator -> Generator (agent-connection)', () => {
    it('should migrate with_session_id_strands.py', async () => {
      tree.write(WITH_SESSION_ID_PATH, OLD_WITH_SESSION_ID);

      const result = await migration(tree);
      const migrated = tree.read(WITH_SESSION_ID_PATH, 'utf-8') ?? '';

      expect(result.nextSteps).toEqual([]);
      expect(migrated).toContain(
        'from collections.abc import Callable, Generator',
      );
      expect(migrated).toContain('-> Generator[Any]:');
      expect(migrated).not.toContain('Iterator');
    });

    it('should migrate session_context.py', async () => {
      tree.write(SESSION_CONTEXT_PATH, OLD_SESSION_CONTEXT);

      const result = await migration(tree);
      const migrated = tree.read(SESSION_CONTEXT_PATH, 'utf-8') ?? '';

      expect(result.nextSteps).toEqual([]);
      expect(migrated).toContain('from collections.abc import Generator');
      expect(migrated).toContain('-> Generator[None]:');
      expect(migrated).not.toContain('Iterator');
    });

    it('should migrate both files together', async () => {
      tree.write(WITH_SESSION_ID_PATH, OLD_WITH_SESSION_ID);
      tree.write(SESSION_CONTEXT_PATH, OLD_SESSION_CONTEXT);

      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      expect(tree.read(WITH_SESSION_ID_PATH, 'utf-8')).not.toContain(
        'Iterator',
      );
      expect(tree.read(SESSION_CONTEXT_PATH, 'utf-8')).not.toContain(
        'Iterator',
      );
    });

    it('should report a diverged with_session_id_strands.py without partially rewriting it', async () => {
      const diverged = OLD_WITH_SESSION_ID.replace(
        'from collections.abc import Callable, Iterator',
        'from collections.abc import Iterator\nfrom my_custom_module import Callable',
      );
      tree.write(WITH_SESSION_ID_PATH, diverged);

      const result = await migration(tree);
      const contents = tree.read(WITH_SESSION_ID_PATH, 'utf-8') ?? '';

      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps[0]).toContain(WITH_SESSION_ID_PATH);
      expect(contents).toContain('from my_custom_module import Callable');
      expect(contents).toContain('Iterator[Any]');
    });

    // The import swap drops `Iterator`, but the annotation rewrite only targets
    // the one exact annotation — so a user's own `Iterator[...]` elsewhere in the
    // file would be left referencing a name that is no longer imported, and the
    // module raises NameError on import.
    it('should leave the file untouched when the user has another Iterator annotation', async () => {
      const withUserIterator = `${OLD_WITH_SESSION_ID}

def user_helper() -> Iterator[str]:
    yield "x"
`;
      tree.write(WITH_SESSION_ID_PATH, withUserIterator);

      const result = await migration(tree);
      const contents = tree.read(WITH_SESSION_ID_PATH, 'utf-8') ?? '';

      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps[0]).toContain(WITH_SESSION_ID_PATH);
      // Either the import stays, or nothing references Iterator any more.
      expect(contents).toContain('Iterator[str]');
      expect(contents).toContain(
        'from collections.abc import Callable, Iterator',
      );
    });

    it('should be idempotent', async () => {
      tree.write(WITH_SESSION_ID_PATH, OLD_WITH_SESSION_ID);
      tree.write(SESSION_CONTEXT_PATH, OLD_SESSION_CONTEXT);

      await migration(tree);
      const once = {
        withSessionId: tree.read(WITH_SESSION_ID_PATH, 'utf-8'),
        sessionContext: tree.read(SESSION_CONTEXT_PATH, 'utf-8'),
      };
      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      expect(tree.read(WITH_SESSION_ID_PATH, 'utf-8')).toEqual(
        once.withSessionId,
      );
      expect(tree.read(SESSION_CONTEXT_PATH, 'utf-8')).toEqual(
        once.sessionContext,
      );
    });
  });
});
