/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { PY_AGENT_GENERATOR_INFO } from '../../../py/agent/generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

// Registers a project with the ComponentMetadata the py#agent generator
// itself writes, since the migration reads protocol/framework/name from it
// rather than guessing from file contents.
const registerAgentProject = (
  tree: Tree,
  name: string,
  root: string,
  protocol: string,
  rc: string,
  framework: string = 'strands',
  agentDir = 'proj_test_project/agent/agent.py',
) =>
  addProjectConfiguration(tree, name, {
    root,
    metadata: {
      components: [
        {
          generator: PY_AGENT_GENERATOR_INFO.id,
          path: agentDir,
          rc,
          protocol,
          framework,
        },
      ],
    } as any,
  });

const HTTP_AGENT_PY_FILE = 'apps/http-project/proj_test_project/agent/agent.py';
const AGUI_MAIN_PY_FILE = 'apps/agui-project/proj_test_project/agent/main.py';

const AGENT_CONNECTION_PROJECT_JSON =
  'packages/common/agent_connection/project.json';
const AGENT_CONNECTION_INIT =
  'packages/common/agent_connection/proj_agent_connection/__init__.py';
const AGENT_CONNECTION_TOOL_ERRORS =
  'packages/common/agent_connection/proj_agent_connection/core/tool_errors_strands.py';

// Mimics a pre-existing agent-connection project, generated before
// tool_errors_strands.py existed.
const registerAgentConnectionProject = (tree: Tree) => {
  tree.write(AGENT_CONNECTION_PROJECT_JSON, '{}');
  tree.write(
    'packages/common/agent_connection/proj_agent_connection/core/model_errors_strands.py',
    'log_model_errors = None\n',
  );
  tree.write(
    AGENT_CONNECTION_INIT,
    `from .core.model_errors_strands import log_model_errors
from .core.session_context import get_current_session_id, session_id_context
from .core.with_session_id_strands import with_session_id

__all__ = ["get_current_session_id", "session_id_context", "with_session_id", "log_model_errors"]
`,
  );
};

const OLD_AGENT_PY_FILE = `from contextlib import contextmanager

from strands import Agent, tool
from strands_tools import current_time
from proj_test_project.agent_connection import (
    ExistingClient,
    log_model_errors,
)


@tool
def subtract(a: int, b: int) -> int:
    return a - b


@contextmanager
def get_agent():
    yield Agent(
        name="HttpProjectAgent",
        description="HttpProjectAgent Strands Agent",
        system_prompt="""
You are a mathematical wizard.
Use your tools for mathematical tasks.
Refer to tools as your 'spellbook'.
""",
        tools=[subtract, current_time],
        hooks=[log_model_errors],
    )
`;

const NON_LITERAL_CONSTRUCTOR_OLD_AGENT_PY_FILE = `from contextlib import contextmanager

from strands import Agent, tool
from strands_tools import current_time
from proj_test_project.agent_connection import log_model_errors

_AGENT_KWARGS = {
    "tools": [current_time],
    "hooks": [log_model_errors],
}


@contextmanager
def get_agent():
    yield Agent(**_AGENT_KWARGS)
`;

const OLD_LANGCHAIN_AGENT_PY_FILE = `import os

from langchain.agents import create_agent
from langchain_aws import ChatBedrockConverse
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver


@tool
def subtract(a: int, b: int) -> int:
    return a - b


def get_agent():
    model = ChatBedrockConverse(model="model", region_name="us-east-1")
    return create_agent(
        model=model,
        tools=[subtract],
        system_prompt="You are helpful.",
        checkpointer=InMemorySaver(),
    )
`;

const OLD_AGUI_MAIN_PY_FILE = `import logging
import uuid
from contextlib import asynccontextmanager

from ag_ui.core import EventType, RunAgentInput, RunErrorEvent
from ag_ui.encoder import EventEncoder
from ag_ui_strands import StrandsAgent
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from proj_test_project.agent_connection import get_current_session_id, session_id_context
from starlette.middleware.base import BaseHTTPMiddleware

from .agent import get_agent

logging.basicConfig(level=logging.INFO)

SESSION_ID_HEADER = "x-amzn-bedrock-agentcore-runtime-session-id"


@asynccontextmanager
async def lifespan(app: FastAPI):
    with get_agent() as agent:
        app.state.agui_agent = StrandsAgent(
            agent=agent,
            name="AguiProjectAgent",
            description="A Strands Agent exposed via the AG-UI protocol.",
        )
        yield


class _SessionIdMiddleware(BaseHTTPMiddleware):
    """Bind the session ID for this request so downstream MCP / A2A clients forward it on outbound calls."""

    async def dispatch(self, request: Request, call_next):
        session_id = request.headers.get(SESSION_ID_HEADER) or str(uuid.uuid4())
        with session_id_context(session_id):
            return await call_next(request)


app = FastAPI(title="AWS Strands - AguiProjectAgent", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(_SessionIdMiddleware)


@app.post("/invocations")
async def invocations(request: Request):
    encoder = EventEncoder(accept=request.headers.get("accept") or "")
    raw = await request.body()
    try:
        input_data = RunAgentInput.model_validate_json(raw)
    except Exception as exc:
        message = f"Invalid RunAgentInput: {str(exc)[:200]}"

        async def _bad():
            yield encoder.encode(RunErrorEvent(type=EventType.RUN_ERROR, message=message, code="BAD_REQUEST"))

        return StreamingResponse(_bad(), media_type=encoder.get_content_type())

    session_id = request.headers.get(SESSION_ID_HEADER) or get_current_session_id()

    async def event_generator():
        with session_id_context(session_id or str(uuid.uuid4())):
            async for event in request.app.state.agui_agent.run(input_data):
                try:
                    yield encoder.encode(event)
                except Exception as e:
                    error_event = RunErrorEvent(
                        type=EventType.RUN_ERROR,
                        message=f"Encoding error: {e}",
                        code="ENCODING_ERROR",
                    )
                    yield encoder.encode(error_event)
                    break

    return StreamingResponse(event_generator(), media_type=encoder.get_content_type())


@app.get("/ping")
async def ping():
    return {"status": "healthy"}
`;

describe('py-agent-session-management-support migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when there is nothing to migrate', async () => {
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('leaves a non-AG-UI agent.py untouched when its owning project cannot be found', async () => {
    tree.write(HTTP_AGENT_PY_FILE, OLD_AGENT_PY_FILE);

    const result = await migration(tree);

    const content = tree.read(HTTP_AGENT_PY_FILE, 'utf-8') ?? '';
    expect(content).not.toContain('get_session_manager');
    expect(
      tree.exists(
        `${HTTP_AGENT_PY_FILE.split('/').slice(0, -1).join('/')}/session.py`,
      ),
    ).toBe(false);
    expect(
      result.nextSteps.some(
        (s) =>
          s.includes(HTTP_AGENT_PY_FILE) &&
          s.includes('could not determine the project root'),
      ),
    ).toBe(true);
  });

  it('leaves a non-AG-UI agent.py entirely untouched when the Agent is not constructed with an inline call', async () => {
    registerAgentProject(
      tree,
      'http-project',
      'apps/http-project',
      'http',
      'HttpProjectAgent',
    );
    tree.write(HTTP_AGENT_PY_FILE, NON_LITERAL_CONSTRUCTOR_OLD_AGENT_PY_FILE);

    const result = await migration(tree);

    const content = tree.read(HTTP_AGENT_PY_FILE, 'utf-8') ?? '';
    expect(content).toContain('Agent(**_AGENT_KWARGS)');
    expect(content).not.toContain('get_session_manager');
    expect(
      tree.exists('apps/http-project/proj_test_project/agent/session.py'),
    ).toBe(false);
    expect(
      result.nextSteps.some(
        (s) =>
          s.includes(HTTP_AGENT_PY_FILE) &&
          s.includes('not constructed with an inline'),
      ),
    ).toBe(true);
  });

  it('wires session_manager into a non-AG-UI agent.py and creates session.py when its project is registered', async () => {
    registerAgentProject(
      tree,
      'http-project',
      'apps/http-project',
      'http',
      'HttpProjectAgent',
    );
    tree.write(HTTP_AGENT_PY_FILE, OLD_AGENT_PY_FILE);

    await migration(tree);

    const content = tree.read(HTTP_AGENT_PY_FILE, 'utf-8') ?? '';
    expect(content).toContain('from .session import get_session_manager');
    expect(content).toContain('session_manager=get_session_manager()');

    const sessionPath = 'apps/http-project/proj_test_project/agent/session.py';
    const sessionContent = tree.read(sessionPath, 'utf-8') ?? '';
    expect(sessionContent).toContain(
      'from proj_test_project.agent_connection import get_current_session_id',
    );
    expect(sessionContent).toContain('FileSessionManager(');
    expect(sessionContent).toContain(
      '../../tmp/agents/strands/http-project-agent',
    );
    expect(sessionContent).toContain('return None');
  });

  it('adds an in-memory and local SQLite checkpointer to a langchain agent', async () => {
    registerAgentProject(
      tree,
      'lc-project',
      'apps/lc-project',
      'http',
      'LcProjectAgent',
      'langchain',
    );
    const lcAgentPath = 'apps/lc-project/proj_test_project/agent/agent.py';
    tree.write(lcAgentPath, OLD_LANGCHAIN_AGENT_PY_FILE);
    tree.write(
      'apps/lc-project/pyproject.toml',
      `[project]
name = "lc-project"
version = "0.1.0"
dependencies = []
`,
    );

    await migration(tree);

    const content = tree.read(lcAgentPath, 'utf-8') ?? '';
    expect(content).toContain('from .session import get_checkpointer');
    expect(content).toContain('checkpointer=get_checkpointer()');
    expect(content).not.toContain(
      'from langgraph.checkpoint.memory import InMemorySaver',
    );
    const sessionContent =
      tree.read(
        'apps/lc-project/proj_test_project/agent/session.py',
        'utf-8',
      ) ?? '';
    expect(sessionContent).toContain('InMemorySaver');
    expect(sessionContent).toContain('AsyncSqliteSaver');
    expect(sessionContent).toContain(
      '../../tmp/agents/langchain/lc-project-agent',
    );
    const migratedPyprojectToml = tree.read(
      'apps/lc-project/pyproject.toml',
      'utf-8',
    );
    expect(migratedPyprojectToml).toContain(
      'langgraph-checkpoint-sqlite==3.1.1',
    );
    expect(migratedPyprojectToml).toContain('aiosqlite==0.22.1');

    const migratedAgent = tree.read(lcAgentPath, 'utf-8');
    const migratedSession = tree.read(
      'apps/lc-project/proj_test_project/agent/session.py',
      'utf-8',
    );
    await migration(tree);
    expect(tree.read(lcAgentPath, 'utf-8')).toBe(migratedAgent);
    expect(
      tree.read('apps/lc-project/proj_test_project/agent/session.py', 'utf-8'),
    ).toBe(migratedSession);
  });

  it('does not wire session_manager directly into an AG-UI agent.py (handled via main.py instead)', async () => {
    registerAgentProject(
      tree,
      'agui-project',
      'apps/agui-project',
      'ag-ui',
      'AguiProjectAgent',
    );
    const aguiAgentPath = 'apps/agui-project/proj_test_project/agent/agent.py';
    tree.write(aguiAgentPath, OLD_AGENT_PY_FILE);

    await migration(tree);

    const content = tree.read(aguiAgentPath, 'utf-8') ?? '';
    expect(content).not.toContain('get_session_manager');
    expect(
      tree.exists('apps/agui-project/proj_test_project/agent/session.py'),
    ).toBe(false);
  });

  it('wires session_manager_provider into an AG-UI main.py and creates session.py when its project is registered', async () => {
    registerAgentProject(
      tree,
      'agui-project',
      'apps/agui-project',
      'ag-ui',
      'AguiProjectAgent',
    );
    tree.write(AGUI_MAIN_PY_FILE, OLD_AGUI_MAIN_PY_FILE);

    await migration(tree);

    const content = tree.read(AGUI_MAIN_PY_FILE, 'utf-8') ?? '';
    expect(content).toContain('StrandsAgentConfig');
    expect(content).toContain('from ag_ui_strands import');
    expect(content).toContain('from .session import get_session_manager');
    expect(content).toContain('config=StrandsAgentConfig(');
    expect(content).toContain(
      'session_manager_provider=lambda _input_data: get_session_manager()',
    );

    const sessionPath = 'apps/agui-project/proj_test_project/agent/session.py';
    const sessionContent = tree.read(sessionPath, 'utf-8') ?? '';
    expect(sessionContent).toContain(
      'from proj_test_project.agent_connection import get_current_session_id',
    );
    expect(sessionContent).toContain(
      '../../tmp/agents/strands/agui-project-agent',
    );
  });

  it('retrofits log_tool_errors into a non-AG-UI agent.py and creates tool_errors_strands.py', async () => {
    registerAgentConnectionProject(tree);
    registerAgentProject(
      tree,
      'http-project',
      'apps/http-project',
      'http',
      'HttpProjectAgent',
    );
    tree.write(HTTP_AGENT_PY_FILE, OLD_AGENT_PY_FILE);

    await migration(tree);

    const content = tree.read(HTTP_AGENT_PY_FILE, 'utf-8') ?? '';
    expect(content).toContain(`from proj_test_project.agent_connection import (
    log_model_errors,
    log_tool_errors,
)`);
    expect(content).toContain('hooks=[log_model_errors, log_tool_errors]');

    expect(tree.exists(AGENT_CONNECTION_TOOL_ERRORS)).toBe(true);
    const toolErrorsContent =
      tree.read(AGENT_CONNECTION_TOOL_ERRORS, 'utf-8') ?? '';
    expect(toolErrorsContent).toContain('log_tool_errors = _LogToolErrors()');
    const init = tree.read(AGENT_CONNECTION_INIT, 'utf-8') ?? '';
    expect(init).toContain('log_tool_errors');
  });

  it('retrofits log_tool_errors into an AG-UI agent.py too, since hooks apply regardless of protocol', async () => {
    registerAgentConnectionProject(tree);
    registerAgentProject(
      tree,
      'agui-project',
      'apps/agui-project',
      'ag-ui',
      'AguiProjectAgent',
    );
    const aguiAgentPath = 'apps/agui-project/proj_test_project/agent/agent.py';
    tree.write(aguiAgentPath, OLD_AGENT_PY_FILE);

    await migration(tree);

    const content = tree.read(aguiAgentPath, 'utf-8') ?? '';
    expect(content).toContain('log_tool_errors');
    expect(content).toContain('hooks=[log_model_errors, log_tool_errors]');
    // session_manager is still skipped for AG-UI (handled via main.py instead).
    expect(content).not.toContain('session_manager=get_session_manager()');
  });

  it('reports a next step for log_tool_errors when the agent-connection project cannot be found', async () => {
    registerAgentProject(
      tree,
      'http-project',
      'apps/http-project',
      'http',
      'HttpProjectAgent',
    );
    tree.write(HTTP_AGENT_PY_FILE, OLD_AGENT_PY_FILE);

    const result = await migration(tree);

    expect(
      result.nextSteps.some(
        (s) =>
          s.includes(HTTP_AGENT_PY_FILE) &&
          s.includes('could not find the shared agent-connection project'),
      ),
    ).toBe(true);
  });

  it('is idempotent', async () => {
    registerAgentConnectionProject(tree);
    registerAgentProject(
      tree,
      'http-project',
      'apps/http-project',
      'http',
      'HttpProjectAgent',
    );
    registerAgentProject(
      tree,
      'agui-project',
      'apps/agui-project',
      'ag-ui',
      'AguiProjectAgent',
    );
    tree.write(HTTP_AGENT_PY_FILE, OLD_AGENT_PY_FILE);
    tree.write(AGUI_MAIN_PY_FILE, OLD_AGUI_MAIN_PY_FILE);

    await migration(tree);
    const firstAgent = tree.read(HTTP_AGENT_PY_FILE, 'utf-8');
    const firstMain = tree.read(AGUI_MAIN_PY_FILE, 'utf-8');
    const firstSession = tree.read(
      'apps/http-project/proj_test_project/agent/session.py',
      'utf-8',
    );

    await migration(tree);
    expect(tree.read(HTTP_AGENT_PY_FILE, 'utf-8')).toEqual(firstAgent);
    expect(tree.read(AGUI_MAIN_PY_FILE, 'utf-8')).toEqual(firstMain);
    expect(
      tree.read(
        'apps/http-project/proj_test_project/agent/session.py',
        'utf-8',
      ),
    ).toEqual(firstSession);
  });
});
