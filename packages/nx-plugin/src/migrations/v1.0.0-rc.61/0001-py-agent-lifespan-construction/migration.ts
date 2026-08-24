/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { PY_AGENT_GENERATOR_INFO } from '../../../py/agent/generator.js';
import {
  addPythonDestructuredImport,
  applyGritQL,
  captureGritQLVariable,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import type { ComponentMetadata } from '../../../utils/nx.js';

/**
 * Move py#agent HTTP/AG-UI agent construction out of module import time and
 * into a FastAPI `lifespan` handler, stored on `app.state`.
 *
 * Building the agent eagerly at import time breaks any codepath that imports
 * the module before `RUNTIME_CONFIG_APP_ID`/AgentCore env vars are set (e.g.
 * OpenAPI spec generation, tests) - and, for AgentCore, construction belongs
 * at container/app startup rather than import, since AgentCore hands each
 * session its own container. The A2A protocol is unaffected: `with_session_id`
 * only touches the agent factory lazily on first use, so its eager
 * `__enter__()` was never actually eager in practice.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 *
 * Guardrails:
 * - Pattern-match before writing: every rewrite this migration makes to a file
 *   is preceded by a read-only `matchGritQL` check of every pattern it will
 *   need - so a diverged file is reported via `nextSteps` and left completely
 *   untouched, rather than partially rewritten into a broken state.
 * - Idempotent: re-running must be a no-op (each rewrite's own shape change
 *   means its pattern no longer matches on a second pass).
 * - Format what you write: finish with `formatFilesInSubtree`.
 */

/** A read-only GritQL match against a python file (no rewrite). */
const pyMatch = (snippet: string) => `language python\n\`${snippet}\``;

/** A GritQL rewrite deleting the matched python snippet entirely. */
const pyDelete = (snippet: string) => `${pyMatch(snippet)} => .`;

/**
 * A GritQL rewrite of one python snippet into another. Multi-line
 * replacements go through `raw` so GritQL's own reformatting doesn't fight
 * the exact shape being written (formatFilesInSubtree normalizes it after).
 */
const pyRewrite = (from: string, to: string, where?: string): string => {
  const replacement = to.includes('\n') ? `raw\`${to}\`` : `\`${to}\``;
  return `${pyMatch(from)} => ${replacement}${where ? ` where { ${where} }` : ''}`;
};

/** All checks must match before anything is written for that agent. */
const allMatch = async (
  tree: Tree,
  checks: ReadonlyArray<readonly [filePath: string, pattern: string]>,
): Promise<boolean> => {
  for (const [filePath, pattern] of checks) {
    if (!(await matchGritQL(tree, filePath, pattern))) return false;
  }
  return true;
};

const AGENT_CONNECTION_MODULE_PATTERN = (names: string) =>
  pyMatch(`from $mod import ${names}`);

const STRANDS_HTTP_MARKER = '_agent_ctx = with_session_id(';
const LANGCHAIN_HTTP_MARKER = '_graph = get_agent()';
const STRANDS_AGUI_MARKER = 'create_strands_app';
const LANGCHAIN_AGUI_MARKER = '_graph = get_agent()';

// Shared by strands/http and langchain/http - only the lifespan body differs.
const HTTP_INIT_APP_OLD = `app = FastAPI(
    title="$name",
    responses={500: {"model": InternalServerErrorDetails}},
    generate_unique_id_function=lambda route: route.name,
)`;

// --- Strands HTTP -----------------------------------------------------------

const STRANDS_HTTP_MAIN_CTX_OLD = `_agent_ctx = with_session_id(
    get_agent,
    name="$name",
    description="A Strands Agent exposed via HTTP streaming.",
)`;

const STRANDS_HTTP_INIT_APP_NEW = `@asynccontextmanager
async def lifespan(app: FastAPI):
    with with_session_id(
        get_agent,
        name="$name",
        description="A Strands Agent exposed via HTTP streaming.",
    ) as agent:
        app.state.agent = agent
        yield


app = FastAPI(
    title="$name",
    responses={500: {"model": InternalServerErrorDetails}},
    generate_unique_id_function=lambda route: route.name,
    lifespan=lifespan,
)`;

const migrateStrandsHttpAgent = async (
  tree: Tree,
  dir: string,
  nextSteps: string[],
): Promise<void> => {
  const initPath = joinPathFragments(dir, 'init.py');
  const mainPath = joinPathFragments(dir, 'main.py');
  if (!tree.exists(initPath) || !tree.exists(mainPath)) return;

  const mainContents = tree.read(mainPath, 'utf-8') ?? '';
  if (!mainContents.includes(STRANDS_HTTP_MARKER)) return;

  const mod = await captureGritQLVariable(
    tree,
    mainPath,
    AGENT_CONNECTION_MODULE_PATTERN('session_id_context, with_session_id'),
    'mod',
  );

  const ready =
    !!mod &&
    (await allMatch(tree, [
      [mainPath, pyMatch(STRANDS_HTTP_MAIN_CTX_OLD)],
      [mainPath, pyMatch('_agent = _agent_ctx.__enter__()')],
      [mainPath, pyMatch('from .agent import get_agent')],
      [mainPath, pyMatch('_agent.stream_async($prompt)')],
      [initPath, pyMatch(HTTP_INIT_APP_OLD)],
    ]));

  if (!ready) {
    nextSteps.push(
      `${mainPath}: diverged from the generated shape - left untouched, along with ${initPath}. Manually move agent construction into an \`init.py\` \`lifespan\` handler storing the agent on \`app.state.agent\` (see the py#agent generator's strands/http template).`,
    );
    return;
  }

  await addPythonDestructuredImport(
    tree,
    initPath,
    ['asynccontextmanager'],
    'contextlib',
  );
  await addPythonDestructuredImport(tree, initPath, ['get_agent'], '.agent');
  await addPythonDestructuredImport(tree, initPath, ['with_session_id'], mod);
  await applyGritQL(
    tree,
    initPath,
    pyRewrite(HTTP_INIT_APP_OLD, STRANDS_HTTP_INIT_APP_NEW),
  );

  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(
      'from $mod import session_id_context, with_session_id',
      'from $mod import session_id_context',
    ),
  );
  await applyGritQL(tree, mainPath, pyDelete('from .agent import get_agent'));
  await applyGritQL(tree, mainPath, pyDelete(STRANDS_HTTP_MAIN_CTX_OLD));
  await applyGritQL(
    tree,
    mainPath,
    pyDelete('_agent = _agent_ctx.__enter__()'),
  );
  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(
      '_agent.stream_async($prompt)',
      'app.state.agent.stream_async($prompt)',
    ),
  );
};

// --- LangChain HTTP ----------------------------------------------------------

const LANGCHAIN_HTTP_INIT_APP_NEW = `@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.graph = get_agent()
    yield


app = FastAPI(
    title="$name",
    responses={500: {"model": InternalServerErrorDetails}},
    generate_unique_id_function=lambda route: route.name,
    lifespan=lifespan,
)`;

const migrateLangchainHttpAgent = async (
  tree: Tree,
  dir: string,
  nextSteps: string[],
): Promise<void> => {
  const initPath = joinPathFragments(dir, 'init.py');
  const mainPath = joinPathFragments(dir, 'main.py');
  if (!tree.exists(initPath) || !tree.exists(mainPath)) return;

  const mainContents = tree.read(mainPath, 'utf-8') ?? '';
  if (!mainContents.includes(LANGCHAIN_HTTP_MARKER)) return;

  const ready = await allMatch(tree, [
    [mainPath, pyMatch('_graph = get_agent()')],
    [mainPath, pyMatch('from .agent import get_agent')],
    [mainPath, pyMatch('_graph.astream($args)')],
    [initPath, pyMatch(HTTP_INIT_APP_OLD)],
  ]);

  if (!ready) {
    nextSteps.push(
      `${mainPath}: diverged from the generated shape - left untouched, along with ${initPath}. Manually wrap \`get_agent()\` in an \`init.py\` \`lifespan\` handler storing the graph on \`app.state.graph\` (see the py#agent generator's langchain/http template).`,
    );
    return;
  }

  await addPythonDestructuredImport(
    tree,
    initPath,
    ['asynccontextmanager'],
    'contextlib',
  );
  await addPythonDestructuredImport(tree, initPath, ['get_agent'], '.agent');
  await applyGritQL(
    tree,
    initPath,
    pyRewrite(HTTP_INIT_APP_OLD, LANGCHAIN_HTTP_INIT_APP_NEW),
  );

  await applyGritQL(tree, mainPath, pyDelete('from .agent import get_agent'));
  await applyGritQL(tree, mainPath, pyDelete('_graph = get_agent()'));
  await applyGritQL(
    tree,
    mainPath,
    pyRewrite('_graph.astream($args)', 'app.state.graph.astream($args)'),
  );
};

// --- LangChain AG-UI ---------------------------------------------------------

const LANGCHAIN_AGUI_AGENT_OLD = `agui_agent = LangGraphAgent(
    name="$name",
    graph=_graph,
    description="A LangChain/LangGraph Agent exposed via the AG-UI protocol.",
)`;

const LANGCHAIN_AGUI_AGENT_NEW = `@asynccontextmanager
async def lifespan(app: FastAPI):
    graph = get_agent()
    app.state.agui_agent = LangGraphAgent(
        name="$name",
        graph=graph,
        description="A LangChain/LangGraph Agent exposed via the AG-UI protocol.",
    )
    yield`;

const migrateLangchainAgUiAgent = async (
  tree: Tree,
  dir: string,
  nextSteps: string[],
): Promise<void> => {
  const mainPath = joinPathFragments(dir, 'main.py');
  if (!tree.exists(mainPath)) return;

  const mainContents = tree.read(mainPath, 'utf-8') ?? '';
  if (!mainContents.includes(LANGCHAIN_AGUI_MARKER)) return;

  const ready = await allMatch(tree, [
    [mainPath, pyMatch('_graph = get_agent()')],
    [mainPath, pyMatch(LANGCHAIN_AGUI_AGENT_OLD)],
    [mainPath, pyMatch('agui_agent.run($input)')],
    [mainPath, pyMatch('app = FastAPI(title="$name")')],
  ]);

  if (!ready) {
    nextSteps.push(
      `${mainPath}: diverged from the generated shape - left untouched. Manually wrap graph + \`LangGraphAgent\` construction in a \`lifespan\` handler storing the wrapper on \`app.state.agui_agent\` (see the py#agent generator's langchain/ag-ui template).`,
    );
    return;
  }

  await addPythonDestructuredImport(
    tree,
    mainPath,
    ['asynccontextmanager'],
    'contextlib',
  );

  await applyGritQL(tree, mainPath, pyDelete('_graph = get_agent()'));
  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(LANGCHAIN_AGUI_AGENT_OLD, LANGCHAIN_AGUI_AGENT_NEW),
  );
  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(
      'agui_agent.run($input)',
      'request.app.state.agui_agent.run($input)',
    ),
  );
  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(
      'app = FastAPI(title="$name")',
      'app = FastAPI(title="$name", lifespan=lifespan)',
    ),
  );
};

// --- Strands AG-UI -----------------------------------------------------------
// The biggest of the four: `ag_ui_strands.create_strands_app` is dropped
// entirely for an inlined FastAPI app (matching upstream `ag_ui_strands`,
// plus a Content-Type-independent body-parsing fix and an explicit session
// re-bind `create_strands_app` was missing), so most of the file is new.

const STRANDS_AGUI_IMPORT_OLD =
  'from ag_ui_strands import StrandsAgent, create_strands_app';

const STRANDS_AGUI_AGENT_OLD = `agui_agent = StrandsAgent(
    agent=_agent,
    name="$name",
    description="A Strands Agent exposed via the AG-UI protocol.",
)`;

const STRANDS_AGUI_AGENT_NEW = `@asynccontextmanager
async def lifespan(app: FastAPI):
    with get_agent() as agent:
        app.state.agui_agent = StrandsAgent(
            agent=agent,
            name="$name",
            description="A Strands Agent exposed via the AG-UI protocol.",
        )
        yield`;

const STRANDS_AGUI_APP_OLD =
  'app = create_strands_app(agui_agent, path="/invocations")';

// `$name` isn't bound within this match (unlike STRANDS_AGUI_AGENT_OLD above),
// so the title is built from a name captured separately rather than reused as
// a metavariable - GritQL leaves a rewrite whose replacement references an
// unbound metavariable unapplied.
const strandsAguiAppNew = (
  name: string,
) => `app = FastAPI(title="AWS Strands - ${name}", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)`;

const STRANDS_AGUI_MIDDLEWARE_OLD = 'app.add_middleware(_SessionIdMiddleware)';

const STRANDS_AGUI_ROUTES_NEW = `app.add_middleware(_SessionIdMiddleware)


@app.post("/invocations")
async def invocations(request: Request):
    # Validate the body manually since AgentCore may omit Content-Type.
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
        # Re-bind the session: the streaming body runs outside the middleware.
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
    return {"status": "healthy"}`;

const STRANDS_AGUI_COMMENTS_OLD = [
  '# Create AG-UI agent wrapper',
  '# Create FastAPI app with AG-UI endpoint and health check',
];

const migrateStrandsAgUiAgent = async (
  tree: Tree,
  dir: string,
  nextSteps: string[],
): Promise<void> => {
  const mainPath = joinPathFragments(dir, 'main.py');
  if (!tree.exists(mainPath)) return;

  const mainContents = tree.read(mainPath, 'utf-8') ?? '';
  if (!mainContents.includes(STRANDS_AGUI_MARKER)) return;

  const mod = await captureGritQLVariable(
    tree,
    mainPath,
    AGENT_CONNECTION_MODULE_PATTERN('session_id_context'),
    'mod',
  );
  const agentClassName = await captureGritQLVariable(
    tree,
    mainPath,
    pyMatch(STRANDS_AGUI_AGENT_OLD),
    'name',
  );

  const ready =
    !!mod &&
    !!agentClassName &&
    (await allMatch(tree, [
      [mainPath, pyMatch(STRANDS_AGUI_IMPORT_OLD)],
      [mainPath, pyMatch('_agent_ctx = get_agent()')],
      [mainPath, pyMatch('_agent = _agent_ctx.__enter__()')],
      [mainPath, pyMatch(STRANDS_AGUI_AGENT_OLD)],
      [mainPath, pyMatch(STRANDS_AGUI_APP_OLD)],
      [mainPath, pyMatch(STRANDS_AGUI_MIDDLEWARE_OLD)],
    ]));

  if (!ready) {
    nextSteps.push(
      `${mainPath}: diverged from the generated shape - left untouched. Manually rebuild this file without \`create_strands_app\`: a \`lifespan\` handler storing the wrapper on \`app.state.agui_agent\`, and inlined \`/invocations\`/\`/ping\` routes with Content-Type-independent body parsing (see the py#agent generator's strands/ag-ui template).`,
    );
    return;
  }

  await addPythonDestructuredImport(
    tree,
    mainPath,
    ['asynccontextmanager'],
    'contextlib',
  );
  await addPythonDestructuredImport(
    tree,
    mainPath,
    ['EventType', 'RunAgentInput', 'RunErrorEvent'],
    'ag_ui.core',
  );
  await addPythonDestructuredImport(
    tree,
    mainPath,
    ['EventEncoder'],
    'ag_ui.encoder',
  );
  await addPythonDestructuredImport(tree, mainPath, ['FastAPI'], 'fastapi');
  await addPythonDestructuredImport(
    tree,
    mainPath,
    ['CORSMiddleware'],
    'fastapi.middleware.cors',
  );
  await addPythonDestructuredImport(
    tree,
    mainPath,
    ['StreamingResponse'],
    'fastapi.responses',
  );
  await addPythonDestructuredImport(
    tree,
    mainPath,
    ['get_current_session_id'],
    mod,
  );

  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(
      STRANDS_AGUI_IMPORT_OLD,
      'from ag_ui_strands import StrandsAgent',
    ),
  );
  await applyGritQL(tree, mainPath, pyDelete('_agent_ctx = get_agent()'));
  await applyGritQL(
    tree,
    mainPath,
    pyDelete('_agent = _agent_ctx.__enter__()'),
  );
  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(STRANDS_AGUI_AGENT_OLD, STRANDS_AGUI_AGENT_NEW),
  );
  for (const comment of STRANDS_AGUI_COMMENTS_OLD) {
    await applyGritQL(tree, mainPath, pyDelete(comment));
  }
  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(STRANDS_AGUI_APP_OLD, strandsAguiAppNew(agentClassName)),
  );
  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(STRANDS_AGUI_MIDDLEWARE_OLD, STRANDS_AGUI_ROUTES_NEW),
  );
};

/** This agent's ComponentMetadata entries. */
const findAgentComponents = (
  components: ComponentMetadata[] | undefined,
): ComponentMetadata[] =>
  (components ?? []).filter(
    (component) => component.generator === PY_AGENT_GENERATOR_INFO.id,
  );

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const project of getProjects(tree).values()) {
    const components = findAgentComponents(
      (project.metadata as { components?: ComponentMetadata[] })?.components,
    );

    for (const component of components) {
      if (!component.path) continue;
      const dir = joinPathFragments(project.root, component.path);
      const framework = component.framework ?? 'strands';

      if (component.protocol === 'http') {
        if (framework === 'langchain') {
          await migrateLangchainHttpAgent(tree, dir, nextSteps);
        } else {
          await migrateStrandsHttpAgent(tree, dir, nextSteps);
        }
      } else if (component.protocol === 'ag-ui') {
        if (framework === 'langchain') {
          await migrateLangchainAgUiAgent(tree, dir, nextSteps);
        } else {
          await migrateStrandsAgUiAgent(tree, dir, nextSteps);
        }
      }
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
