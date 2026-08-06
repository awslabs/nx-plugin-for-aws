/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { PY_AGENT_GENERATOR_INFO } from '../../../py/agent/generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

const AGENT_DIR = 'apps/test-project/proj_test_project/agent';
const AGENT_CONNECTION_MODULE = 'proj_agent_connection';
const AGENT_NAME = 'SnapshotAgent';

const setUpProject = (
  tree: Tree,
  protocol: 'http' | 'ag-ui' | 'a2a',
  framework?: 'strands' | 'langchain',
) => {
  addProjectConfiguration(tree, 'test-project', {
    root: 'apps/test-project',
    sourceRoot: 'apps/test-project/proj_test_project',
    targets: {},
    metadata: {
      components: [
        {
          generator: PY_AGENT_GENERATOR_INFO.id,
          path: 'proj_test_project/agent',
          protocol,
          ...(framework ? { framework } : {}),
          rc: AGENT_NAME,
        },
      ],
    } as any,
  });
};

const OLD_STRANDS_HTTP_INIT = `import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from starlette.middleware.exceptions import ExceptionMiddleware


class InternalServerErrorDetails(BaseModel):
    detail: str


class JsonStreamingResponse(StreamingResponse):
    media_type = "application/jsonl"


app = FastAPI(
    title="${AGENT_NAME}",
    responses={500: {"model": InternalServerErrorDetails}},
    generate_unique_id_function=lambda route: route.name,
)

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.add_middleware(ExceptionMiddleware, handlers=app.exception_handlers)
`;

const OLD_STRANDS_HTTP_MAIN = `import uuid

import uvicorn
from bedrock_agentcore.runtime.models import PingStatus
from fastapi import Request
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware
from ${AGENT_CONNECTION_MODULE} import session_id_context, with_session_id

from .agent import get_agent
from .init import JsonStreamingResponse, app

SESSION_ID_HEADER = "x-amzn-bedrock-agentcore-runtime-session-id"

_agent_ctx = with_session_id(
    get_agent,
    name="${AGENT_NAME}",
    description="A Strands Agent exposed via HTTP streaming.",
)
_agent = _agent_ctx.__enter__()


class InvokeInput(BaseModel):
    prompt: str = Field(max_length=100000)


async def handle_invoke(input: InvokeInput):
    stream = _agent.stream_async(input.prompt)
    async for event in stream:
        pass


class _SessionIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        session_id = request.headers.get(SESSION_ID_HEADER) or str(uuid.uuid4())
        with session_id_context(session_id):
            return await call_next(request)


app.add_middleware(_SessionIdMiddleware)
`;

const OLD_LANGCHAIN_HTTP_INIT = `import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from starlette.middleware.exceptions import ExceptionMiddleware


class InternalServerErrorDetails(BaseModel):
    detail: str


class JsonStreamingResponse(StreamingResponse):
    media_type = "application/jsonl"


app = FastAPI(
    title="${AGENT_NAME}",
    responses={500: {"model": InternalServerErrorDetails}},
    generate_unique_id_function=lambda route: route.name,
)
`;

const OLD_LANGCHAIN_HTTP_MAIN = `import uuid

import uvicorn
from bedrock_agentcore.runtime.models import PingStatus
from fastapi import Request
from ${AGENT_CONNECTION_MODULE} import get_current_session_id, session_id_context
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware

from .agent import get_agent
from .init import JsonStreamingResponse, app

SESSION_ID_HEADER = "x-amzn-bedrock-agentcore-runtime-session-id"

_graph = get_agent()


class InvokeInput(BaseModel):
    prompt: str = Field(max_length=100000)


async def handle_invoke(input: InvokeInput, session_id: str):
    config = {"configurable": {"thread_id": session_id}}
    with session_id_context(session_id):
        stream = _graph.astream(
            {"messages": [{"role": "user", "content": input.prompt}]},
            config,
            stream_mode="messages",
        )
`;

const OLD_LANGCHAIN_AGUI_MAIN = `import logging
import time
import uuid

from ag_ui.core import EventType, RunAgentInput, RunErrorEvent
from ag_ui.encoder import EventEncoder
from ag_ui_langgraph import LangGraphAgent
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from ${AGENT_CONNECTION_MODULE} import get_current_session_id, session_id_context
from starlette.middleware.base import BaseHTTPMiddleware

from .agent import get_agent

logging.basicConfig(level=logging.INFO)

SESSION_ID_HEADER = "x-amzn-bedrock-agentcore-runtime-session-id"

_graph = get_agent()

agui_agent = LangGraphAgent(
    name="${AGENT_NAME}",
    graph=_graph,
    description="A LangChain/LangGraph Agent exposed via the AG-UI protocol.",
)


class _SessionIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        session_id = request.headers.get(SESSION_ID_HEADER) or str(uuid.uuid4())
        with session_id_context(session_id):
            return await call_next(request)


app = FastAPI(title="${AGENT_NAME}")
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
    accept = request.headers.get("accept") or ""
    encoder = EventEncoder(accept=accept)
    raw = await request.body()
    input_data = RunAgentInput.model_validate_json(raw)
    session_id = request.headers.get(SESSION_ID_HEADER) or get_current_session_id()

    async def event_generator():
        with session_id_context(session_id or str(uuid.uuid4())):
            try:
                async for event in agui_agent.run(input_data):
                    yield encoder.encode(event)
            except Exception as e:
                yield encoder.encode(RunErrorEvent(type=EventType.RUN_ERROR, message=str(e)[:300], code="AGENT_ERROR"))

    return StreamingResponse(event_generator(), media_type=encoder.get_content_type())


@app.get("/ping")
async def ping():
    return JSONResponse({"status": "Healthy", "time_of_last_update": int(time.time())})
`;

const OLD_STRANDS_AGUI_MAIN = `import logging
import uuid

from ag_ui_strands import StrandsAgent, create_strands_app
from fastapi import Request
from ${AGENT_CONNECTION_MODULE} import session_id_context
from starlette.middleware.base import BaseHTTPMiddleware

from .agent import get_agent

logging.basicConfig(level=logging.INFO)

SESSION_ID_HEADER = "x-amzn-bedrock-agentcore-runtime-session-id"

# Create AG-UI agent wrapper
_agent_ctx = get_agent()
_agent = _agent_ctx.__enter__()

agui_agent = StrandsAgent(
    agent=_agent,
    name="${AGENT_NAME}",
    description="A Strands Agent exposed via the AG-UI protocol.",
)


class _SessionIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        session_id = request.headers.get(SESSION_ID_HEADER) or str(uuid.uuid4())
        with session_id_context(session_id):
            return await call_next(request)


# Create FastAPI app with AG-UI endpoint and health check
app = create_strands_app(agui_agent, path="/invocations")
app.add_middleware(_SessionIdMiddleware)
`;

describe('py-agent-lifespan-construction migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should be a no-op when no py#agent components exist', async () => {
    addProjectConfiguration(tree, 'other-project', {
      root: 'apps/other-project',
    });
    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
  });

  it('should move strands http agent construction into a lifespan handler', async () => {
    setUpProject(tree, 'http', 'strands');
    tree.write(`${AGENT_DIR}/init.py`, OLD_STRANDS_HTTP_INIT);
    tree.write(`${AGENT_DIR}/main.py`, OLD_STRANDS_HTTP_MAIN);

    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);

    const init = tree.read(`${AGENT_DIR}/init.py`, 'utf-8') ?? '';
    expect(init).toContain('async def lifespan(app: FastAPI)');
    expect(init).toContain('with with_session_id(');
    expect(init).toContain('app.state.agent = agent');
    expect(init).toContain('lifespan=lifespan');
    expect(init).toContain('from .agent import get_agent');
    expect(init).toContain(
      `from ${AGENT_CONNECTION_MODULE} import with_session_id`,
    );

    const main = tree.read(`${AGENT_DIR}/main.py`, 'utf-8') ?? '';
    expect(main).not.toContain('_agent_ctx');
    expect(main).not.toContain('with_session_id');
    expect(main).not.toContain('from .agent import get_agent');
    expect(main).toContain('app.state.agent.stream_async(input.prompt)');
    expect(main).toContain(
      `from ${AGENT_CONNECTION_MODULE} import session_id_context`,
    );

    // Idempotent: re-running is a no-op.
    const before = tree.read(`${AGENT_DIR}/main.py`, 'utf-8');
    const beforeInit = tree.read(`${AGENT_DIR}/init.py`, 'utf-8');
    const second = await migration(tree);
    expect(second.nextSteps).toEqual([]);
    expect(tree.read(`${AGENT_DIR}/main.py`, 'utf-8')).toEqual(before);
    expect(tree.read(`${AGENT_DIR}/init.py`, 'utf-8')).toEqual(beforeInit);
  });

  it('should move langchain http agent construction into a lifespan handler', async () => {
    setUpProject(tree, 'http', 'langchain');
    tree.write(`${AGENT_DIR}/init.py`, OLD_LANGCHAIN_HTTP_INIT);
    tree.write(`${AGENT_DIR}/main.py`, OLD_LANGCHAIN_HTTP_MAIN);

    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);

    const init = tree.read(`${AGENT_DIR}/init.py`, 'utf-8') ?? '';
    expect(init).toContain('async def lifespan(app: FastAPI)');
    expect(init).toContain('app.state.graph = get_agent()');
    expect(init).toContain('lifespan=lifespan');
    expect(init).toContain('from .agent import get_agent');

    const main = tree.read(`${AGENT_DIR}/main.py`, 'utf-8') ?? '';
    expect(main).not.toContain('_graph = get_agent()');
    expect(main).not.toContain('from .agent import get_agent');
    expect(main).toContain('app.state.graph.astream(');

    const before = tree.read(`${AGENT_DIR}/main.py`, 'utf-8');
    const beforeInit = tree.read(`${AGENT_DIR}/init.py`, 'utf-8');
    const second = await migration(tree);
    expect(second.nextSteps).toEqual([]);
    expect(tree.read(`${AGENT_DIR}/main.py`, 'utf-8')).toEqual(before);
    expect(tree.read(`${AGENT_DIR}/init.py`, 'utf-8')).toEqual(beforeInit);
  });

  it('should move langchain ag-ui agent construction into a lifespan handler', async () => {
    setUpProject(tree, 'ag-ui', 'langchain');
    tree.write(`${AGENT_DIR}/main.py`, OLD_LANGCHAIN_AGUI_MAIN);

    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);

    const main = tree.read(`${AGENT_DIR}/main.py`, 'utf-8') ?? '';
    expect(main).not.toContain('_graph = get_agent()');
    expect(main).toContain('async def lifespan(app: FastAPI)');
    expect(main).toContain('graph = get_agent()');
    expect(main).toContain('app.state.agui_agent = LangGraphAgent(');
    expect(main).toContain('request.app.state.agui_agent.run(input_data)');
    expect(main).toContain(
      'app = FastAPI(title="SnapshotAgent", lifespan=lifespan)',
    );

    const before = tree.read(`${AGENT_DIR}/main.py`, 'utf-8');
    const second = await migration(tree);
    expect(second.nextSteps).toEqual([]);
    expect(tree.read(`${AGENT_DIR}/main.py`, 'utf-8')).toEqual(before);
  });

  it('should rebuild strands ag-ui agent off create_strands_app into a lifespan handler', async () => {
    setUpProject(tree, 'ag-ui', 'strands');
    tree.write(`${AGENT_DIR}/main.py`, OLD_STRANDS_AGUI_MAIN);

    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);

    const main = tree.read(`${AGENT_DIR}/main.py`, 'utf-8') ?? '';
    expect(main).not.toContain('create_strands_app');
    expect(main).not.toContain('_agent_ctx');
    expect(main).toContain('async def lifespan(app: FastAPI)');
    expect(main).toContain('with get_agent() as agent:');
    expect(main).toContain('app.state.agui_agent = StrandsAgent(');
    expect(main).toContain(
      'app = FastAPI(title="AWS Strands - SnapshotAgent", lifespan=lifespan)',
    );
    expect(main).toContain('async def invocations(request: Request):');
    expect(main).toContain('RunAgentInput.model_validate_json(raw)');
    expect(main).toContain('request.app.state.agui_agent.run(input_data)');
    expect(main).toContain('async def ping():');
    expect(main).toContain(
      `from ${AGENT_CONNECTION_MODULE} import get_current_session_id, session_id_context`,
    );

    const before = tree.read(`${AGENT_DIR}/main.py`, 'utf-8');
    const second = await migration(tree);
    expect(second.nextSteps).toEqual([]);
    expect(tree.read(`${AGENT_DIR}/main.py`, 'utf-8')).toEqual(before);
  });

  it('should leave a2a agents untouched', async () => {
    setUpProject(tree, 'a2a', 'strands');
    const original = `from strands.multiagent.a2a import A2AServer

from .agent import get_agent

_agent_ctx = get_agent()
_agent = _agent_ctx.__enter__()
server = A2AServer(agent=_agent)
`;
    tree.write(`${AGENT_DIR}/main.py`, original);

    const result = await migration(tree);
    expect(result.nextSteps).toEqual([]);
    expect(tree.read(`${AGENT_DIR}/main.py`, 'utf-8')).toEqual(original);
  });

  it('should report a diverged strands http agent without touching it', async () => {
    setUpProject(tree, 'http', 'strands');
    tree.write(`${AGENT_DIR}/init.py`, OLD_STRANDS_HTTP_INIT);
    // Diverged: an extra user-added kwarg breaks the exact-shape match.
    const diverged = OLD_STRANDS_HTTP_MAIN.replace(
      'description="A Strands Agent exposed via HTTP streaming.",',
      'description="A Strands Agent exposed via HTTP streaming.",\n    custom_kwarg=True,',
    );
    tree.write(`${AGENT_DIR}/main.py`, diverged);

    const result = await migration(tree);
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain(`${AGENT_DIR}/init.py`);

    // init.py is untouched since main.py's construction call couldn't be
    // safely resolved into the expected shape (formatFilesInSubtree may still
    // reformat it, since it was written to the tree, so check markers rather
    // than exact byte equality).
    const init = tree.read(`${AGENT_DIR}/init.py`, 'utf-8') ?? '';
    expect(init).not.toContain('lifespan');
    expect(init).not.toContain('with_session_id');
  });
});
