/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
  visitNotIgnoredFiles,
} from '@nx/devkit';
import { PY_AGENT_GENERATOR_INFO } from '../../../py/agent/generator';
import {
  addPythonDestructuredImport,
  applyGritQL,
  captureGritQLVariable,
  matchGritQL,
} from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import type { ComponentMetadata } from '../../../utils/nx';

/**
 * Move py#agent A2A agent construction (Strands and LangChain) out of module
 * import time and into a FastAPI `lifespan` handler, stored on `app.state`.
 *
 * The `v1.0.0-rc.61/0001-py-agent-lifespan-construction` migration (HTTP/AG-UI)
 * deliberately left A2A alone, reasoning that `with_session_id` only touches
 * its agent factory lazily on first use, so the eager `_agent_ctx.__enter__()`
 * was never actually eager in practice. That held for `with_session_id`'s own
 * laziness, but missed a separate trigger: `strands.multiagent.a2a.executor
 * .StrandsA2AExecutor.__init__`, in its deprecated single-`agent=` mode, does
 * `getattr(agent, "_session_manager", None)` - which the session-routing
 * proxy's `__getattr__` happily serves by building the real underlying Agent
 * right then, under a bogus "default" session, since no request has bound a
 * real session id yet. That call happens inside `A2AServer.__init__`, which
 * the old template constructed at plain module import time - so the "lazy"
 * proxy was forced eager anyway, just one layer further down than the
 * previous migration checked.
 *
 * Strands: `agent_factory=` mode sidesteps this - `StrandsA2AExecutor` takes
 * an entirely different branch when given a factory (no `_session_manager`
 * probe at all), and the one placeholder call `A2AServer.__init__` makes
 * before `lifespan` has run returns a bare `SimpleNamespace` with just
 * `name`/`description` - no `__getattr__`, nothing to force construction.
 *
 * LangChain: the compiled graph from `get_agent()` has no such trap, but was
 * still built eagerly at import time (`_graph = get_agent()`). Moved into
 * `lifespan` for the same reason HTTP/AG-UI were: it can require env vars
 * (model id, region) or do network setup that isn't guaranteed available at
 * import - e.g. under test collection or OpenAPI spec generation tooling.
 *
 * Also folds in an unrelated but adjacent fix: Pylance (Pyright) deprecates
 * annotating a `@contextmanager`-decorated function's return type as
 * `Iterator[T]`, in favor of the single-argument `Generator[T]` form enabled
 * by PEP 696 default type parameters (Python 3.13+ - generated projects
 * target >=3.14). `with_session_id_strands.py` and `session_context.py` both
 * use this pattern. Both files are shared, protocol-agnostic files copied
 * once per workspace (not per py#agent component), so that part scans the
 * whole tree by basename rather than going through component metadata.
 */
const pyMatch = (snippet: string) => `language python\n\`${snippet}\``;

const pyDelete = (snippet: string) => `${pyMatch(snippet)} => .`;

const pyRewrite = (from: string, to: string): string => {
  const replacement = to.includes('\n') ? `raw\`${to}\`` : `\`${to}\``;
  return `${pyMatch(from)} => ${replacement}`;
};

const AGENT_ENTER = '_agent = _agent_ctx.__enter__()';

const OLD_AGENT_CONTEXT = `_agent_ctx = with_session_id(
    get_agent,
    name="$name",
    description="A Strands Agent exposed via the Agent-to-Agent (A2A) protocol.",
)`;

const NEW_CONSTANTS_AND_LIFESPAN = `AGENT_NAME = "$name"
AGENT_DESCRIPTION = "A Strands Agent exposed via the Agent-to-Agent (A2A) protocol."

# A2AServer.__init__ calls agent_factory once, synchronously, before the lifespan
# below has run - this is what it reads name/description from at that point.
# The cast is a lie about runtime shape, not behavior: only .name/.description
# are ever read off this value.
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
        yield`;

const A2A_SERVER_STATEMENT = 'a2a_server = A2AServer($args)';

const OLD_MOUNT_STATEMENT = 'app.mount("/", a2a_server.to_fastapi_app())';

const OLD_FASTAPI_APP = 'app = FastAPI()';

const NEW_FASTAPI_APP = 'app = FastAPI(lifespan=lifespan)';

const SERVER_MATCH =
  'language python\n`A2AServer($args)` where { $args <: contains `agent=_agent` }';

const allMatch = async (
  tree: Tree,
  filePath: string,
  patterns: string[],
): Promise<boolean> => {
  for (const pattern of patterns) {
    if (!(await matchGritQL(tree, filePath, pattern))) return false;
  }
  return true;
};

const migrateStrandsA2AAgent = async (
  tree: Tree,
  mainPath: string,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(mainPath)) return;

  const contents = tree.read(mainPath, 'utf-8') ?? '';
  if (!contents.includes('_agent_ctx = with_session_id(')) return;

  const ready = await allMatch(tree, mainPath, [
    pyMatch('import logging'),
    pyMatch('from $mod import session_id_context, with_session_id'),
    pyMatch(OLD_AGENT_CONTEXT),
    pyMatch(AGENT_ENTER),
    pyMatch(OLD_FASTAPI_APP),
    pyMatch(OLD_MOUNT_STATEMENT),
    SERVER_MATCH,
  ]);

  const diverged = () => {
    nextSteps.push(
      `${mainPath}: diverged from the generated Strands A2A shape - left untouched. Manually rebuild the agent inside the FastAPI \`lifespan\` and have \`agent_factory\` read it off \`app.state\` (see the py#agent generator's strands/a2a template).`,
    );
  };

  if (!ready) {
    diverged();
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
    ['SimpleNamespace'],
    'types',
  );
  await addPythonDestructuredImport(tree, mainPath, ['cast'], 'typing');
  await addPythonDestructuredImport(tree, mainPath, ['Agent'], 'strands');
  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(OLD_AGENT_CONTEXT, NEW_CONSTANTS_AND_LIFESPAN),
  );
  await applyGritQL(tree, mainPath, pyDelete(AGENT_ENTER));

  // Swap the kwarg while the call is still in its original spot (any extra
  // kwargs a user added are left alone), then capture the whole arg list so
  // it can be reinserted at the call's new home below.
  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(
      'agent=_agent',
      'agent_factory=lambda _context_id: getattr(app.state, "agent", _card_placeholder)',
    ),
  );
  const capturedArgs = await captureGritQLVariable(
    tree,
    mainPath,
    `language python\n\`${A2A_SERVER_STATEMENT}\``,
    'args',
  );
  if (capturedArgs === undefined) {
    diverged();
    return;
  }

  await applyGritQL(tree, mainPath, pyDelete(A2A_SERVER_STATEMENT));
  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(OLD_FASTAPI_APP, NEW_FASTAPI_APP),
  );
  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(
      OLD_MOUNT_STATEMENT,
      `a2a_server = A2AServer(${capturedArgs})\n\n${OLD_MOUNT_STATEMENT}`,
    ),
  );
};

// --- LangChain A2A -----------------------------------------------------------

const LANGCHAIN_GRAPH_OLD = '_graph = get_agent()';

const LANGCHAIN_LIFESPAN_NEW = `@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.agent = get_agent()
    yield`;

const LANGCHAIN_GRAPH_INVOKE_OLD = '_graph.ainvoke($args)';

const LANGCHAIN_GRAPH_INVOKE_NEW = 'app.state.agent.ainvoke($args)';

const LANGCHAIN_APP_OLD = 'app = FastAPI(title="$name")';

const LANGCHAIN_APP_NEW = 'app = FastAPI(title="$name", lifespan=lifespan)';

const migrateLangchainA2AAgent = async (
  tree: Tree,
  mainPath: string,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(mainPath)) return;

  const contents = tree.read(mainPath, 'utf-8') ?? '';
  if (!contents.includes(LANGCHAIN_GRAPH_OLD)) return;

  const ready = await allMatch(tree, mainPath, [
    pyMatch(LANGCHAIN_GRAPH_OLD),
    pyMatch('from .agent import get_agent'),
    pyMatch(LANGCHAIN_GRAPH_INVOKE_OLD),
    pyMatch(LANGCHAIN_APP_OLD),
  ]);

  if (!ready) {
    nextSteps.push(
      `${mainPath}: diverged from the generated LangChain A2A shape - left untouched. Manually wrap \`get_agent()\` in a \`lifespan\` handler storing the graph on \`app.state.agent\` (see the py#agent generator's langchain/a2a template).`,
    );
    return;
  }

  await addPythonDestructuredImport(
    tree,
    mainPath,
    ['asynccontextmanager'],
    'contextlib',
  );
  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(LANGCHAIN_GRAPH_OLD, LANGCHAIN_LIFESPAN_NEW),
  );
  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(LANGCHAIN_GRAPH_INVOKE_OLD, LANGCHAIN_GRAPH_INVOKE_NEW),
  );
  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(LANGCHAIN_APP_OLD, LANGCHAIN_APP_NEW),
  );
};

// --- Iterator -> Generator (with_session_id_strands.py / session_context.py) ---

const WITH_SESSION_ID_IMPORT_OLD =
  'from collections.abc import Callable, Iterator';
const WITH_SESSION_ID_IMPORT_NEW =
  'from collections.abc import Callable, Generator';

/**
 * Whether every `Iterator` reference in the file is one this migration is about
 * to convert, so dropping the import cannot leave an undefined name behind. A
 * user's own `Iterator[...]` annotation elsewhere in the file is not rewritten
 * (the rewrite targets one exact annotation), so removing the import would leave
 * the module raising `NameError` on import.
 */
const onlyIteratorUseIs = (contents: string, annotation: string): boolean => {
  const withoutImport = contents.replace(
    /^from collections\.abc import .*$/m,
    '',
  );
  const uses = withoutImport.match(/\bIterator\b/g) ?? [];
  const converted = withoutImport.match(
    new RegExp(annotation.replace(/[[\]]/g, '\\$&'), 'g'),
  );
  return uses.length === (converted?.length ?? 0);
};

const migrateWithSessionId = async (
  tree: Tree,
  filePath: string,
  nextSteps: string[],
): Promise<void> => {
  const contents = tree.read(filePath, 'utf-8') ?? '';
  if (!contents.includes('Iterator[Any]')) return;

  const ready =
    (await allMatch(tree, filePath, [
      pyMatch(WITH_SESSION_ID_IMPORT_OLD),
      pyMatch('Iterator[Any]'),
    ])) && onlyIteratorUseIs(contents, 'Iterator[Any]');

  if (!ready) {
    nextSteps.push(
      `${filePath}: diverged from the generated shape - left untouched. Manually change the \`Iterator\` import and \`Iterator[Any]\` return annotation on \`with_session_id\` to \`Generator\`/\`Generator[Any]\` (see the agent-connection generator's with_session_id_strands.py template).`,
    );
    return;
  }

  await applyGritQL(
    tree,
    filePath,
    pyRewrite(WITH_SESSION_ID_IMPORT_OLD, WITH_SESSION_ID_IMPORT_NEW),
  );
  await applyGritQL(
    tree,
    filePath,
    pyRewrite('Iterator[Any]', 'Generator[Any]'),
  );
};

const SESSION_CONTEXT_IMPORT_OLD = 'from collections.abc import Iterator';
const SESSION_CONTEXT_IMPORT_NEW = 'from collections.abc import Generator';

const migrateSessionContext = async (
  tree: Tree,
  filePath: string,
  nextSteps: string[],
): Promise<void> => {
  const contents = tree.read(filePath, 'utf-8') ?? '';
  if (!contents.includes('Iterator[None]')) return;

  const ready =
    (await allMatch(tree, filePath, [
      pyMatch(SESSION_CONTEXT_IMPORT_OLD),
      pyMatch('Iterator[None]'),
    ])) && onlyIteratorUseIs(contents, 'Iterator[None]');

  if (!ready) {
    nextSteps.push(
      `${filePath}: diverged from the generated shape - left untouched. Manually change the \`Iterator\` import and \`Iterator[None]\` return annotation on \`session_id_context\` to \`Generator\`/\`Generator[None]\` (see the agent-connection generator's session_context.py template).`,
    );
    return;
  }

  await applyGritQL(
    tree,
    filePath,
    pyRewrite(SESSION_CONTEXT_IMPORT_OLD, SESSION_CONTEXT_IMPORT_NEW),
  );
  await applyGritQL(
    tree,
    filePath,
    pyRewrite('Iterator[None]', 'Generator[None]'),
  );
};

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
      if (!component.path || component.protocol !== 'a2a') {
        continue;
      }

      const componentDir = component.path.endsWith('/agent.py')
        ? component.path.slice(0, -'/agent.py'.length)
        : component.path;
      const mainPath = joinPathFragments(project.root, componentDir, 'main.py');

      if ((component.framework ?? 'strands') === 'langchain') {
        await migrateLangchainA2AAgent(tree, mainPath, nextSteps);
      } else {
        await migrateStrandsA2AAgent(tree, mainPath, nextSteps);
      }
    }
  }

  const filePaths: string[] = [];
  visitNotIgnoredFiles(tree, '', (filePath) => filePaths.push(filePath));

  for (const filePath of filePaths) {
    if (filePath.endsWith('/with_session_id_strands.py')) {
      await migrateWithSessionId(tree, filePath, nextSteps);
    } else if (filePath.endsWith('/session_context.py')) {
      await migrateSessionContext(tree, filePath, nextSteps);
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
