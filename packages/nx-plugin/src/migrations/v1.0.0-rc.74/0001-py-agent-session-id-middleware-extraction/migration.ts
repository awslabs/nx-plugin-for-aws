/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
 * Extract the `_SessionIdMiddleware` class - previously duplicated verbatim
 * in every py#agent `main.py` (one copy per framework/protocol combination) -
 * into a shared `middleware/session_id_middleware.py` module sitting beside
 * `main.py`, mirroring the http#/a2a#/ag-ui#'s own `common/agent.py` and
 * `common/session.py` sharing pattern.
 *
 * The transform is protocol/framework-agnostic: every generated `main.py`
 * duplicated the exact same `dispatch` body (only the docstring differs
 * between AG-UI and HTTP/A2A), so one rewrite handles all six shapes. Imports
 * that only existed to support the inlined class (`uuid`, `Request`,
 * `BaseHTTPMiddleware`, `session_id_context`) are left for the trailing
 * `formatFilesInSubtree` ruff pass to prune if they've gone unused - AG-UI's
 * `main.py` still uses several of them directly, so nothing here can safely
 * assume any one of them is dead.
 */
const pyMatch = (snippet: string) => `language python\n\`${snippet}\``;

const pyDelete = (snippet: string) => `${pyMatch(snippet)} => .`;

const pyRewrite = (from: string, to: string): string => {
  const replacement = to.includes('\n') ? `raw\`${to}\`` : `\`${to}\``;
  return `${pyMatch(from)} => ${replacement}`;
};

// Both frameworks import `session_id_context` from the shared agent-connection
// module alongside other names, so this both confirms the old shape is
// present and recovers the module name to import the new middleware from.
const SESSION_ID_CONTEXT_MOD_CAPTURE =
  'language python\n`from $mod import $names` where { $names <: contains `session_id_context` }';

const SESSION_ID_HEADER_LINE =
  'SESSION_ID_HEADER = "x-amzn-bedrock-agentcore-runtime-session-id"';

const ADD_MIDDLEWARE_OLD = 'app.add_middleware(_SessionIdMiddleware)';
const ADD_MIDDLEWARE_NEW = 'app.add_middleware(SessionIdMiddleware)';

// HTTP and A2A share this docstring verbatim; AG-UI's differs (see below).
const OLD_CLASS_INBOUND = `class _SessionIdMiddleware(BaseHTTPMiddleware):
    """Bind the inbound session (or a fresh UUID) to async context."""

    async def dispatch(self, request: Request, call_next):
        session_id = request.headers.get(SESSION_ID_HEADER) or str(uuid.uuid4())
        with session_id_context(session_id):
            return await call_next(request)`;

const OLD_CLASS_DOWNSTREAM = `class _SessionIdMiddleware(BaseHTTPMiddleware):
    """Bind the session ID for this request so downstream MCP / A2A clients forward it on outbound calls."""

    async def dispatch(self, request: Request, call_next):
        session_id = request.headers.get(SESSION_ID_HEADER) or str(uuid.uuid4())
        with session_id_context(session_id):
            return await call_next(request)`;

// Both framework common/ dirs vend byte-identical middleware content (the
// LangChain copy would work equally well); this one is read as the single
// source of truth rather than hand-duplicating it here.
const SESSION_ID_MIDDLEWARE_TEMPLATE = readFileSync(
  join(
    import.meta.dirname,
    '../../../py/agent/files/strands/common/middleware/session_id_middleware.py.template',
  ),
  'utf-8',
);

const sessionIdMiddlewareContent = (agentConnectionModule: string): string =>
  SESSION_ID_MIDDLEWARE_TEMPLATE.replace(
    '<%- agentConnectionModuleName %>',
    agentConnectionModule,
  );

const findAgentComponents = (
  components: ComponentMetadata[] | undefined,
): ComponentMetadata[] =>
  (components ?? []).filter(
    (component) => component.generator === PY_AGENT_GENERATOR_INFO.id,
  );

const migrateMain = async (
  tree: Tree,
  mainPath: string,
  component: ComponentMetadata,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(mainPath)) return;

  const contents = tree.read(mainPath, 'utf-8') ?? '';
  if (!contents.includes('class _SessionIdMiddleware(')) return;

  const oldClass = contents.includes(
    'Bind the session ID for this request so downstream MCP / A2A clients forward it on outbound calls.',
  )
    ? OLD_CLASS_DOWNSTREAM
    : OLD_CLASS_INBOUND;

  const ready =
    (await matchGritQL(tree, mainPath, pyMatch(oldClass))) &&
    (await matchGritQL(tree, mainPath, pyMatch(SESSION_ID_HEADER_LINE))) &&
    (await matchGritQL(tree, mainPath, pyMatch(ADD_MIDDLEWARE_OLD))) &&
    (await matchGritQL(tree, mainPath, SESSION_ID_CONTEXT_MOD_CAPTURE));

  const diverged = () => {
    const shape = [component.framework, component.protocol]
      .filter(Boolean)
      .join('/');
    nextSteps.push(
      `${mainPath}: diverged from the generated ${shape || 'py#agent'} shape - left untouched. Manually move \`_SessionIdMiddleware\` into a sibling \`middleware/session_id_middleware.py\` module and import it from there (see the py#agent generator's template).`,
    );
  };

  if (!ready) {
    diverged();
    return;
  }

  const mod = await captureGritQLVariable(
    tree,
    mainPath,
    SESSION_ID_CONTEXT_MOD_CAPTURE,
    'mod',
  );
  if (!mod) {
    diverged();
    return;
  }

  const dir = mainPath.split('/').slice(0, -1).join('/');
  const middlewareInitPath = joinPathFragments(
    dir,
    'middleware',
    '__init__.py',
  );
  const middlewarePath = joinPathFragments(
    dir,
    'middleware',
    'session_id_middleware.py',
  );

  if (!tree.exists(middlewareInitPath)) {
    tree.write(middlewareInitPath, '');
  }
  if (!tree.exists(middlewarePath)) {
    tree.write(middlewarePath, sessionIdMiddlewareContent(mod));
  }

  await applyGritQL(tree, mainPath, pyDelete(SESSION_ID_HEADER_LINE));
  await applyGritQL(tree, mainPath, pyDelete(oldClass));
  await applyGritQL(
    tree,
    mainPath,
    pyRewrite(ADD_MIDDLEWARE_OLD, ADD_MIDDLEWARE_NEW),
  );
  // Imported unconditionally - SESSION_ID_HEADER is only still referenced by
  // AG-UI's main.py after the class is gone; the ruff pass below prunes it
  // from HTTP/A2A's now-unused import list.
  await addPythonDestructuredImport(
    tree,
    mainPath,
    ['SESSION_ID_HEADER', 'SessionIdMiddleware'],
    '.middleware.session_id_middleware',
  );
};

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

      const componentDir = component.path.endsWith('/agent.py')
        ? component.path.slice(0, -'/agent.py'.length)
        : component.path;
      const mainPath = joinPathFragments(project.root, componentDir, 'main.py');

      await migrateMain(tree, mainPath, component, nextSteps);
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
