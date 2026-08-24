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
const MAIN_PY = `${AGENT_DIR}/main.py`;
const MIDDLEWARE_INIT_PY = `${AGENT_DIR}/middleware/__init__.py`;
const MIDDLEWARE_PY = `${AGENT_DIR}/middleware/session_id_middleware.py`;

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
          protocol: options.protocol ?? 'http',
          framework: options.framework ?? 'strands',
          rc: 'SnapshotAgent',
        },
      ],
    } as any,
  });
};

const OLD_STRANDS_HTTP_MAIN = `import uuid

import uvicorn
from bedrock_agentcore.runtime.models import PingStatus
from fastapi import Request
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
from proj_agent_connection import session_id_context

from .init import JsonStreamingResponse, app

SESSION_ID_HEADER = "x-amzn-bedrock-agentcore-runtime-session-id"


class InvokeInput(BaseModel):
    prompt: str = Field(max_length=100000)


class StreamChunk(BaseModel):
    content: str


async def handle_invoke(input: InvokeInput):
    """Streaming handler for agent invocation"""
    stream = app.state.agent.stream_async(input.prompt)
    async for event in stream:
        text = event.get("event", {}).get("contentBlockDelta", {}).get("delta", {}).get("text")
        if text is not None:
            yield StreamChunk(content=text)


@app.post("/invocations")
async def invoke(input: InvokeInput) -> JsonStreamingResponse:
    """Entry point for agent invocation"""
    return JsonStreamingResponse(handle_invoke(input))


class _SessionIdMiddleware(BaseHTTPMiddleware):
    """Bind the inbound session (or a fresh UUID) to async context."""

    async def dispatch(self, request: Request, call_next):
        session_id = request.headers.get(SESSION_ID_HEADER) or str(uuid.uuid4())
        with session_id_context(session_id):
            return await call_next(request)


app.add_middleware(_SessionIdMiddleware)


@app.get("/ping")
def ping() -> str:
    return PingStatus.HEALTHY


if __name__ == "__main__":
    uvicorn.run("proj_test_project.agent.main:app", port=8080)
`;

const OLD_STRANDS_A2A_MAIN = `import logging
import os
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace
from typing import cast

from fastapi import FastAPI, Request
from starlette.middleware.base import BaseHTTPMiddleware
from strands import Agent
from strands.multiagent.a2a import A2AServer
from proj_agent_connection import session_id_context, with_session_id

from .agent import get_agent

logging.basicConfig(level=logging.INFO)

PORT = int(os.environ.get("PORT", "9000"))
RUNTIME_URL = os.environ.get("AGENTCORE_RUNTIME_URL", f"http://localhost:{PORT}/")
SESSION_ID_HEADER = "x-amzn-bedrock-agentcore-runtime-session-id"
AGENT_NAME = "SnapshotAgent"
AGENT_DESCRIPTION = "A Strands Agent exposed via the Agent-to-Agent (A2A) protocol."

_card_placeholder = cast(
    Agent, SimpleNamespace(name=AGENT_NAME, description=AGENT_DESCRIPTION)
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    with with_session_id(
        get_agent,
        name=AGENT_NAME,
        description=AGENT_DESCRIPTION,
    ) as agent:
        app.state.agent = agent
        yield


class _SessionIdMiddleware(BaseHTTPMiddleware):
    """Bind the inbound session (or a fresh UUID) to async context."""

    async def dispatch(self, request: Request, call_next):
        session_id = request.headers.get(SESSION_ID_HEADER) or str(uuid.uuid4())
        with session_id_context(session_id):
            return await call_next(request)


app = FastAPI(lifespan=lifespan)
app.add_middleware(_SessionIdMiddleware)


@app.get("/ping")
def ping() -> dict[str, str]:
    return {"status": "Healthy"}


a2a_server = A2AServer(
    agent_factory=lambda _context_id: getattr(app.state, "agent", _card_placeholder),
    port=PORT,
    http_url=RUNTIME_URL,
    serve_at_root=True,
    skills=[],
)

app.mount("/", a2a_server.to_fastapi_app())
`;

const OLD_STRANDS_AGUI_MAIN = `import logging
import uuid
from contextlib import asynccontextmanager

from ag_ui.core import EventType, RunAgentInput, RunErrorEvent
from ag_ui.encoder import EventEncoder
from ag_ui_strands import StrandsAgent, StrandsAgentConfig
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from proj_agent_connection import get_current_session_id, session_id_context
from starlette.middleware.base import BaseHTTPMiddleware

from .agent import get_agent
from .session import get_session_manager

logging.basicConfig(level=logging.INFO)

SESSION_ID_HEADER = "x-amzn-bedrock-agentcore-runtime-session-id"


@asynccontextmanager
async def lifespan(app: FastAPI):
    with get_agent() as agent:
        app.state.agui_agent = StrandsAgent(
            agent=agent,
            name="SnapshotAgent",
            description="A Strands Agent exposed via the AG-UI protocol.",
            config=StrandsAgentConfig(session_manager_provider=lambda _input_data: get_session_manager()),
        )
        yield


class _SessionIdMiddleware(BaseHTTPMiddleware):
    """Bind the session ID for this request so downstream MCP / A2A clients forward it on outbound calls."""

    async def dispatch(self, request: Request, call_next):
        session_id = request.headers.get(SESSION_ID_HEADER) or str(uuid.uuid4())
        with session_id_context(session_id):
            return await call_next(request)


app = FastAPI(title="AWS Strands - SnapshotAgent", lifespan=lifespan)
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
    input_data = RunAgentInput.model_validate_json(raw)

    session_id = request.headers.get(SESSION_ID_HEADER) or get_current_session_id()

    async def event_generator():
        with session_id_context(session_id or str(uuid.uuid4())):
            async for event in request.app.state.agui_agent.run(input_data):
                yield encoder.encode(event)

    return StreamingResponse(event_generator(), media_type=encoder.get_content_type())


@app.get("/ping")
async def ping():
    return {"status": "healthy"}
`;

describe('py-agent-session-id-middleware-extraction migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should do nothing when no projects contain Python agents', async () => {
    await expect(migration(tree)).resolves.toEqual({ nextSteps: [] });
  });

  describe('Strands HTTP', () => {
    it('should extract the middleware into a shared module', async () => {
      setUpProject(tree, { protocol: 'http' });
      tree.write(MAIN_PY, OLD_STRANDS_HTTP_MAIN);

      const result = await migration(tree);
      const migrated = tree.read(MAIN_PY, 'utf-8') ?? '';

      expect(result.nextSteps).toEqual([]);
      expect(migrated).not.toContain('class _SessionIdMiddleware');
      expect(migrated).not.toContain(
        'SESSION_ID_HEADER = "x-amzn-bedrock-agentcore-runtime-session-id"',
      );
      expect(migrated).toContain('app.add_middleware(SessionIdMiddleware)');
      expect(migrated).toContain(
        'from .middleware.session_id_middleware import SessionIdMiddleware',
      );
      // ruff's F401 pass prunes every import that only existed to support the
      // now-deleted class.
      expect(migrated).not.toContain('import uuid');
      expect(migrated).not.toContain('Request');
      expect(migrated).not.toContain('BaseHTTPMiddleware');
      expect(migrated).not.toContain('session_id_context');

      expect(tree.exists(MIDDLEWARE_INIT_PY)).toBe(true);
      expect(tree.read(MIDDLEWARE_INIT_PY, 'utf-8')).toEqual('');

      const middleware = tree.read(MIDDLEWARE_PY, 'utf-8') ?? '';
      expect(middleware).toContain(
        'class SessionIdMiddleware(BaseHTTPMiddleware):',
      );
      expect(middleware).toContain(
        'from proj_agent_connection import session_id_context',
      );
      expect(middleware).toContain(
        'SESSION_ID_HEADER = "x-amzn-bedrock-agentcore-runtime-session-id"',
      );
    });

    it('should support legacy component paths ending in agent.py', async () => {
      setUpProject(tree, {
        protocol: 'http',
        path: 'proj_test_project/agent/agent.py',
      });
      tree.write(MAIN_PY, OLD_STRANDS_HTTP_MAIN);

      await migration(tree);

      expect(tree.exists(MIDDLEWARE_PY)).toBe(true);
      expect(tree.read(MAIN_PY, 'utf-8')).toContain(
        'app.add_middleware(SessionIdMiddleware)',
      );
    });

    it('should report a diverged generated shape without partially rewriting it', async () => {
      setUpProject(tree, { protocol: 'http' });
      const diverged = OLD_STRANDS_HTTP_MAIN.replace(
        '"""Bind the inbound session (or a fresh UUID) to async context."""',
        '"""My custom docstring."""',
      );
      tree.write(MAIN_PY, diverged);

      const result = await migration(tree);
      const contents = tree.read(MAIN_PY, 'utf-8') ?? '';

      expect(result.nextSteps).toHaveLength(1);
      expect(result.nextSteps[0]).toContain(MAIN_PY);
      expect(contents).toContain('class _SessionIdMiddleware');
      expect(contents).toContain('My custom docstring.');
      expect(tree.exists(MIDDLEWARE_PY)).toBe(false);
    });

    it('should be idempotent', async () => {
      setUpProject(tree, { protocol: 'http' });
      tree.write(MAIN_PY, OLD_STRANDS_HTTP_MAIN);

      await migration(tree);
      const once = {
        main: tree.read(MAIN_PY, 'utf-8'),
        middleware: tree.read(MIDDLEWARE_PY, 'utf-8'),
      };
      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      expect(tree.read(MAIN_PY, 'utf-8')).toEqual(once.main);
      expect(tree.read(MIDDLEWARE_PY, 'utf-8')).toEqual(once.middleware);
    });
  });

  describe('Strands A2A', () => {
    it('should extract the middleware into a shared module', async () => {
      setUpProject(tree, { protocol: 'a2a' });
      tree.write(MAIN_PY, OLD_STRANDS_A2A_MAIN);

      const result = await migration(tree);
      const migrated = tree.read(MAIN_PY, 'utf-8') ?? '';

      expect(result.nextSteps).toEqual([]);
      expect(migrated).not.toContain('class _SessionIdMiddleware');
      expect(migrated).toContain('app.add_middleware(SessionIdMiddleware)');
      expect(migrated).toContain('with_session_id(');
      expect(tree.exists(MIDDLEWARE_PY)).toBe(true);
    });
  });

  describe('Strands AG-UI', () => {
    it('should extract the middleware while keeping SESSION_ID_HEADER usable', async () => {
      setUpProject(tree, { protocol: 'ag-ui' });
      tree.write(MAIN_PY, OLD_STRANDS_AGUI_MAIN);

      const result = await migration(tree);
      const migrated = tree.read(MAIN_PY, 'utf-8') ?? '';

      expect(result.nextSteps).toEqual([]);
      expect(migrated).not.toContain('class _SessionIdMiddleware');
      expect(migrated).not.toContain(
        'SESSION_ID_HEADER = "x-amzn-bedrock-agentcore-runtime-session-id"',
      );
      expect(migrated).toContain('app.add_middleware(SessionIdMiddleware)');
      // Still referenced directly in the /invocations handler, so the import
      // must survive ruff's unused-import pass, unlike HTTP/A2A above.
      expect(migrated).toContain(
        'from .middleware.session_id_middleware import SESSION_ID_HEADER, SessionIdMiddleware',
      );
      expect(migrated).toContain(
        'session_id = request.headers.get(SESSION_ID_HEADER) or get_current_session_id()',
      );

      const middleware = tree.read(MIDDLEWARE_PY, 'utf-8') ?? '';
      expect(middleware).toContain(
        'Bind the session ID for this request so downstream MCP / A2A clients forward it on outbound calls.',
      );
    });

    it('should be idempotent', async () => {
      setUpProject(tree, { protocol: 'ag-ui' });
      tree.write(MAIN_PY, OLD_STRANDS_AGUI_MAIN);

      await migration(tree);
      const once = tree.read(MAIN_PY, 'utf-8');
      const result = await migration(tree);

      expect(result.nextSteps).toEqual([]);
      expect(tree.read(MAIN_PY, 'utf-8')).toEqual(once);
    });
  });

  it('should not overwrite an already-customised shared middleware module', async () => {
    setUpProject(tree, { protocol: 'http' });
    tree.write(MAIN_PY, OLD_STRANDS_HTTP_MAIN);
    tree.write(MIDDLEWARE_PY, '# customised by the user\n');

    await migration(tree);

    expect(tree.read(MIDDLEWARE_PY, 'utf-8')).toEqual(
      '# customised by the user\n',
    );
  });
});
