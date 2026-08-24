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
  type ProjectConfiguration,
  type Tree,
  visitNotIgnoredFiles,
} from '@nx/devkit';
import { PY_AGENT_GENERATOR_INFO } from '../../../py/agent/generator.js';
import { addPyDependencies } from '../../../utils/add-dependencies.js';
import {
  addPythonReExport,
  getPythonAgentConnectionModuleName,
  getPythonAgentConnectionProjectDir,
} from '../../../utils/agent-connection/agent-connection.js';
import {
  applyGritQL,
  captureGritQLVariable,
  matchGritQL,
} from '../../../utils/ast.js';
import { declareDependencies } from '../../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { kebabCase } from '../../../utils/names.js';
import type { ComponentMetadata } from '../../../utils/nx.js';
import {
  getRelativePathToRootByDirectory,
  toProjectRelativePath,
} from '../../../utils/paths.js';

/**
 * Add session management support to py#agent.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 *
 * Guardrails:
 * - Pattern-match before writing: skip files that have diverged from the shape
 *   your generators produce and report them via `nextSteps`, rather than
 *   clobbering the user's changes.
 * - Idempotent: re-running must be a no-op.
 * - Format what you write: finish with `formatFilesInSubtree` so the files
 *   this migration wrote are formatted correctly.
 */

// Captures the agent-connection module a file imports `log_model_errors` (or
// `session_id_context`) from, and gates every rewrite below on the import
// actually being present. Generic over `$names` since a connection generator
// may have merged its own import into the same line.
const LOG_MODEL_ERRORS_IMPORT_CAPTURE_PATTERN =
  'language python\n`from $mod import $names` where { $names <: contains `log_model_errors` }';
const SESSION_ID_CONTEXT_IMPORT_CAPTURE_PATTERN =
  'language python\n`from $mod import $names` where { $names <: contains `session_id_context` }';

const DEPENDENCIES = declareDependencies()({
  py: [{ name: 'langgraph-checkpoint-sqlite' }, { name: 'aiosqlite' }],
  ts: [],
});

const LANGCHAIN_AGENT_MATCH_PATTERN =
  'language python\n`create_agent($args)` where { $args <: contains `system_prompt=$_`, $args <: contains `checkpointer=InMemorySaver()` }';
const LANGCHAIN_CHECKPOINTER_PATTERN =
  'language python\n`checkpointer=InMemorySaver()` => `checkpointer=get_checkpointer()`';
const LANGCHAIN_IN_MEMORY_IMPORT_PATTERN =
  'language python\n`from langgraph.checkpoint.memory import InMemorySaver` => .';
const langChainSessionImportPattern =
  'language python\n`from langchain.agents import create_agent` => raw`from langchain.agents import create_agent\n\nfrom .session import get_checkpointer`';

// Every strands agent.py already hooks log_model_errors regardless of
// protocol (hooks, unlike session_manager, carry over per-thread for AG-UI
// without special wiring — see StrandsAgent's kwargs-forwarding), so
// log_tool_errors is retrofitted the same way for every protocol.
const LOG_TOOL_ERRORS_HOOKS_PATTERN =
  'language python\n`hooks=[$hooks]` where { $hooks <: contains `log_model_errors`, $hooks <: not contains `log_tool_errors` }';
const logToolErrorsImportPattern = (mod: string) =>
  `language python\n\`from contextlib import contextmanager\` => raw\`from contextlib import contextmanager\nfrom ${mod} import log_tool_errors\``;
const LOG_TOOL_ERRORS_WRITE_PATTERN =
  'language python\n`hooks=[log_model_errors]` => `hooks=[log_model_errors, log_tool_errors]`';

// Existing agent-connection projects predate tool_errors_strands.py. This has
// no EJS templating, so it's read verbatim from the generator's own template
// rather than kept as a second, hand-copied source of truth.
const TOOL_ERRORS_STRANDS_PY_CONTENT = readFileSync(
  join(
    import.meta.dirname,
    '../../../utils/agent-connection/files/py-core-strands/base/tool_errors_strands.py.template',
  ),
  'utf-8',
);

/**
 * Ensures the shared Python agent-connection project has tool_errors_strands.py
 * and re-exports log_tool_errors, backfilling projects generated before this
 * helper existed. Returns false (and leaves the tree untouched) if the
 * agent-connection project itself can't be found.
 */
async function ensureToolErrorsBase(tree: Tree): Promise<boolean> {
  const projectDir = getPythonAgentConnectionProjectDir(tree);
  if (!tree.exists(joinPathFragments(projectDir, 'project.json'))) {
    return false;
  }
  const moduleDir = joinPathFragments(
    projectDir,
    getPythonAgentConnectionModuleName(tree),
  );
  const toolErrorsPath = joinPathFragments(
    moduleDir,
    'core',
    'tool_errors_strands.py',
  );
  if (!tree.exists(toolErrorsPath)) {
    tree.write(toolErrorsPath, TOOL_ERRORS_STRANDS_PY_CONTENT);
  }
  await addPythonReExport(
    tree,
    joinPathFragments(moduleDir, '__init__.py'),
    '.core.tool_errors_strands',
    'log_tool_errors',
  );
  return true;
}

// HTTP/A2A agents build one Agent per session (via with_session_id), so
// wiring `session_manager` directly into the constructor is safe. Anchored
// on a `tools=` keyword argument so this only matches an inline kwargs call
// (as the generator produces), not e.g. `Agent(**agent_kwargs)`.
const AGENT_PY_CONSTRUCTOR_MATCH_PATTERN =
  'language python\n`Agent($args)` where { $args <: contains `tools=$_` }';
const AGENT_PY_SESSION_MANAGER_PATTERN =
  'language python\n`yield Agent($args)` => `yield Agent(session_manager=get_session_manager(), $args)` where { $args <: not contains `session_manager=$_` }';
const AGENT_PY_SESSION_IMPORT_PATTERN =
  'language python\n`from contextlib import contextmanager` => raw`from contextlib import contextmanager\n\nfrom .session import get_session_manager`';

// AG-UI's StrandsAgent adapter needs a session_manager_provider (called once
// per thread_id) rather than a plain session_manager.
const AGUI_MAIN_IMPORT_PATTERN =
  'language python\n`from ag_ui_strands import $names` => `from ag_ui_strands import StrandsAgentConfig, $names` where { $names <: contains `StrandsAgent`, $names <: not contains `StrandsAgentConfig` }';
const AGUI_MAIN_CONSTRUCTOR_MATCH_PATTERN =
  'language python\n`StrandsAgent($args)` where { $args <: contains `agent=$_` }';
const AGUI_MAIN_CONSTRUCTOR_PATTERN = `${AGUI_MAIN_CONSTRUCTOR_MATCH_PATTERN} => \`StrandsAgent(config=StrandsAgentConfig(session_manager_provider=lambda _input_data: get_session_manager()), $args)\` where { $args <: not contains \`config=\` }`;
const AGUI_MAIN_SESSION_IMPORT_PATTERN =
  'language python\n`from .agent import get_agent` => raw`from .agent import get_agent\nfrom .session import get_session_manager` where { $program <: not contains `from .session import get_session_manager` }';

// Existing agents predate session.py, so there's no prior storage to
// preserve — default to in-memory, mirroring the ts#agent migration.
const legacySessionManagerContent = (
  agentConnectionModule: string,
  localSessionsDir: string,
): string =>
  `import os

from strands.session import FileSessionManager, SessionManager

from ${agentConnectionModule} import get_current_session_id


def get_session_manager() -> SessionManager | None:
    """Returns a SessionManager for persisting conversation state across
    invocations. Local development always uses local file storage for
    convenience, regardless of the configured session option. Without a
    configured session option, conversation state is kept in memory only and
    does not survive process restarts.
    """
    session_id = get_current_session_id()
    if not session_id:
        raise RuntimeError(
            "No current session id — cannot resolve a SessionManager outside of a request scope."
        )
    if os.environ.get("LOCAL_DEV") == "true":
        return FileSessionManager(session_id=session_id, storage_dir="${localSessionsDir}")
    return None
`;

const legacyLangChainSessionContent = (localSessionsDir: string): string =>
  `import os

import aiosqlite
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver


def get_checkpointer() -> BaseCheckpointSaver:
    """Returns the checkpointer used to persist conversation state."""
    if os.environ.get("LOCAL_DEV") == "true":
        os.makedirs("${localSessionsDir}", exist_ok=True)
        conn = aiosqlite.connect(os.path.join("${localSessionsDir}", "checkpoints.sqlite"))
        return AsyncSqliteSaver(conn)
    return InMemorySaver()
`;

/** The Nx project owning `dirPath`, if any (the longest-matching project.root). */
const findOwningProject = (
  tree: Tree,
  dirPath: string,
): ProjectConfiguration | undefined => {
  let best: ProjectConfiguration | undefined;
  for (const project of getProjects(tree).values()) {
    if (
      (dirPath === project.root || dirPath.startsWith(`${project.root}/`)) &&
      (!best || project.root.length > best.root.length)
    ) {
      best = project;
    }
  }
  return best;
};

/** This agent's metadata, accepting both current and legacy component paths. */
const findAgentComponentMetadata = (
  project: ProjectConfiguration,
  dirRelativeToProjectRoot: string,
): ComponentMetadata | undefined =>
  (project.metadata as { components?: ComponentMetadata[] })?.components?.find(
    (component) =>
      component.generator === PY_AGENT_GENERATOR_INFO.id &&
      (component.path === dirRelativeToProjectRoot ||
        component.path === `${dirRelativeToProjectRoot}/agent.py`),
  );

/**
 * This agent's real kebab-case name — the generator's own target-prefix
 * (ComponentMetadata's `name` field), used directly rather than
 * reconstructing it by kebab-casing the class name (`rc`). That round trip
 * loses word boundaries for names with single-letter segments, e.g.
 * `kebabCase("OldSHttp")` => "old-shttp", not the real "old-s-http".
 *
 * When no `--name` was given at generation time, the generator falls back
 * to `${project}-agent` for the real name, but records a literal 'agent' as
 * the target-prefix — indistinguishable from an agent explicitly named
 * "agent" — so re-derive the fallback from the project name in that case,
 * exactly as the generator itself does.
 */
const agentTmpNameFor = (
  project: ProjectConfiguration,
  dir: string,
): string | undefined => {
  const dirRelativeToProjectRoot = toProjectRelativePath(project, dir);
  const targetPrefix = findAgentComponentMetadata(
    project,
    dirRelativeToProjectRoot,
  )?.name;
  if (!targetPrefix) return undefined;
  if (targetPrefix !== 'agent') return targetPrefix;
  return kebabCase(`${project.name.split('.').pop() ?? project.name}-agent`);
};

/** This agent's protocol + framework, from its ComponentMetadata entry. */
const agentComponentFor = (
  project: ProjectConfiguration,
  dir: string,
): ComponentMetadata | undefined => {
  const dirRelativeToProjectRoot = toProjectRelativePath(project, dir);
  return findAgentComponentMetadata(project, dirRelativeToProjectRoot);
};

/** The relative path from `projectRoot` up to this agent's workspace-root-level local session storage. */
const localSessionsDirFor = (
  projectRoot: string,
  agentTmpName: string,
  framework: 'strands' | 'langchain' = 'strands',
): string =>
  joinPathFragments(
    getRelativePathToRootByDirectory(projectRoot),
    `tmp/agents/${framework}/${agentTmpName}`,
  );

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  const filePaths: string[] = [];
  visitNotIgnoredFiles(tree, '', (filePath) => filePaths.push(filePath));

  for (const filePath of filePaths) {
    if (filePath.endsWith('/agent.py')) {
      // log_tool_errors applies to every protocol (unlike session_manager),
      // so retrofit it independently of whether the owning project can be
      // resolved below. LOG_TOOL_ERRORS_HOOKS_PATTERN's own `where` clause
      // (contains log_model_errors, not already containing log_tool_errors)
      // doubles as the "still needs retrofitting" check.
      if (await matchGritQL(tree, filePath, LOG_TOOL_ERRORS_HOOKS_PATTERN)) {
        const mod = await captureGritQLVariable(
          tree,
          filePath,
          LOG_MODEL_ERRORS_IMPORT_CAPTURE_PATTERN,
          'mod',
        );
        if ((await ensureToolErrorsBase(tree)) && mod) {
          await applyGritQL(tree, filePath, logToolErrorsImportPattern(mod));
          await applyGritQL(tree, filePath, LOG_TOOL_ERRORS_WRITE_PATTERN);
        } else {
          nextSteps.push(
            `${filePath}: could not find the shared agent-connection project — manually add \`log_tool_errors\` to the hooks list (see the py#agent generator's template).`,
          );
        }
      }

      const dir = filePath.split('/').slice(0, -1).join('/');
      const project = findOwningProject(tree, dir);

      // Without a registered project there's no ComponentMetadata, so this
      // agent's protocol/framework/agent-connection module can't be
      // resolved — and a pre-migration AG-UI agent.py is textually identical
      // to an HTTP/A2A one, so there's nothing left to safely guess from.
      if (!project) {
        if (
          await matchGritQL(
            tree,
            filePath,
            LOG_MODEL_ERRORS_IMPORT_CAPTURE_PATTERN,
          )
        ) {
          nextSteps.push(
            `${filePath}: could not determine the project root — manually verify whether this is an AG-UI or HTTP/A2A Strands agent and wire session_manager in accordingly (see the py#agent generator's template).`,
          );
        }
        continue;
      }

      const component = agentComponentFor(project, dir);

      if (component?.framework === 'langchain') {
        const content = tree.read(filePath, 'utf-8') ?? '';
        if (content.includes('checkpointer=get_checkpointer()')) {
          continue;
        }
        if (
          !(await matchGritQL(tree, filePath, LANGCHAIN_AGENT_MATCH_PATTERN))
        ) {
          nextSteps.push(
            `${filePath}: the create_agent call has diverged from the generated shape — manually create ${dir}/session.py and pass \`checkpointer=get_checkpointer()\` to \`create_agent\` (see the py#agent generator's template).`,
          );
          continue;
        }

        const agentName = agentTmpNameFor(project, dir);
        const sessionPath = `${dir}/session.py`;
        if (!agentName) {
          nextSteps.push(
            `${filePath}: could not determine this agent's name from its ComponentMetadata — manually create ${sessionPath} and pass \`checkpointer=get_checkpointer()\` to \`create_agent\` (see the py#agent generator's template).`,
          );
          continue;
        }

        if (!tree.exists(sessionPath)) {
          tree.write(
            sessionPath,
            legacyLangChainSessionContent(
              localSessionsDirFor(project.root, agentName, 'langchain'),
            ),
          );
        }
        addPyDependencies(tree, DEPENDENCIES, { projectRoot: project.root });
        await applyGritQL(tree, filePath, langChainSessionImportPattern);
        await applyGritQL(tree, filePath, LANGCHAIN_IN_MEMORY_IMPORT_PATTERN);
        await applyGritQL(tree, filePath, LANGCHAIN_CHECKPOINTER_PATTERN);
        const migratedContent = tree.read(filePath, 'utf-8') ?? '';
        if (
          !migratedContent.includes('from .session import get_checkpointer') ||
          !migratedContent.includes('checkpointer=get_checkpointer()')
        ) {
          nextSteps.push(
            `${filePath}: session.py was created but the checkpointer could not be wired automatically — import \`get_checkpointer\` from it and pass \`checkpointer=get_checkpointer()\` to \`create_agent\`.`,
          );
        }
        continue;
      }

      // AG-UI wires session_manager_provider on the StrandsAgent adapter in
      // main.py instead — handled by the branch below.
      if (component?.protocol === 'ag-ui') {
        continue;
      }

      if (!component?.protocol) {
        if (
          await matchGritQL(
            tree,
            filePath,
            LOG_MODEL_ERRORS_IMPORT_CAPTURE_PATTERN,
          )
        ) {
          nextSteps.push(
            `${filePath}: could not determine this agent's protocol/framework from its ComponentMetadata — manually verify whether it's AG-UI or HTTP/A2A Strands and wire session_manager in accordingly (see the py#agent generator's template).`,
          );
        }
        continue;
      }

      // HTTP/A2A: wire session_manager into the Agent constructor and create
      // the sibling session.py if it doesn't exist yet.
      if (
        !(await matchGritQL(
          tree,
          filePath,
          LOG_MODEL_ERRORS_IMPORT_CAPTURE_PATTERN,
        ))
      ) {
        continue;
      }

      const sessionPath = `${dir}/session.py`;

      if (
        !(await matchGritQL(tree, filePath, AGENT_PY_CONSTRUCTOR_MATCH_PATTERN))
      ) {
        nextSteps.push(
          `${filePath}: the Agent is not constructed with an inline \`Agent(...)\` call, so session_manager could not be wired in automatically. Manually add \`session_manager=get_session_manager()\` to its constructor (see the py#agent generator's template), creating ${sessionPath} first if it doesn't already exist.`,
        );
        continue;
      }

      if (!tree.exists(sessionPath)) {
        const mod = await captureGritQLVariable(
          tree,
          filePath,
          LOG_MODEL_ERRORS_IMPORT_CAPTURE_PATTERN,
          'mod',
        );
        const agentName = agentTmpNameFor(project, dir);

        if (mod && agentName) {
          tree.write(
            sessionPath,
            legacySessionManagerContent(
              mod,
              localSessionsDirFor(project.root, agentName),
            ),
          );
        } else {
          nextSteps.push(
            `${filePath}: could not determine the agent-connection module or this agent's name from its ComponentMetadata — manually create ${sessionPath} (see the py#agent generator's template) and wire \`session_manager=get_session_manager()\` into the Agent constructor.`,
          );
          continue;
        }
      }

      const agentContent = tree.read(filePath, 'utf-8') ?? '';
      if (!agentContent.includes('from .session import get_session_manager')) {
        await applyGritQL(tree, filePath, AGENT_PY_SESSION_IMPORT_PATTERN);
        await applyGritQL(tree, filePath, AGENT_PY_SESSION_MANAGER_PATTERN);
      }

      if (
        !(tree.read(filePath, 'utf-8') ?? '').includes('get_session_manager')
      ) {
        nextSteps.push(
          `${filePath}: found ${sessionPath} but couldn't confirm the get_session_manager import — wire \`session_manager=get_session_manager()\` into the Agent constructor manually.`,
        );
        continue;
      }

      continue;
    }

    if (
      filePath.endsWith('/main.py') &&
      (tree.read(filePath, 'utf-8') ?? '').includes('ag_ui_strands')
    ) {
      const alreadyWired = (tree.read(filePath, 'utf-8') ?? '').includes(
        'StrandsAgentConfig',
      );

      if (!alreadyWired) {
        const needsWiring = await matchGritQL(
          tree,
          filePath,
          AGUI_MAIN_CONSTRUCTOR_MATCH_PATTERN,
        );
        if (!needsWiring) {
          nextSteps.push(
            `${filePath}: the StrandsAgent constructor has diverged from the generated shape - left as-is. Manually add \`config=StrandsAgentConfig(session_manager_provider=lambda _input_data: get_session_manager())\` to it (see the py#agent generator's template).`,
          );
          continue;
        }

        await applyGritQL(tree, filePath, AGUI_MAIN_IMPORT_PATTERN);
        await applyGritQL(tree, filePath, AGUI_MAIN_CONSTRUCTOR_PATTERN);
      }

      const dir = filePath.split('/').slice(0, -1).join('/');
      const sessionPath = `${dir}/session.py`;

      if (!tree.exists(sessionPath)) {
        const project = findOwningProject(tree, dir);
        const mod = await captureGritQLVariable(
          tree,
          filePath,
          SESSION_ID_CONTEXT_IMPORT_CAPTURE_PATTERN,
          'mod',
        );
        const agentName = project && agentTmpNameFor(project, dir);

        if (project && mod && agentName) {
          tree.write(
            sessionPath,
            legacySessionManagerContent(
              mod,
              localSessionsDirFor(project.root, agentName),
            ),
          );
        } else {
          nextSteps.push(
            `${filePath}: could not determine the project root, agent-connection module, or this agent's name from its ComponentMetadata — manually create ${sessionPath} (see the py#agent generator's template) and wire \`config=StrandsAgentConfig(session_manager_provider=lambda _input_data: get_session_manager())\` into the StrandsAgent constructor.`,
          );
          continue;
        }
      }

      await applyGritQL(tree, filePath, AGUI_MAIN_SESSION_IMPORT_PATTERN);

      if (
        !(tree.read(filePath, 'utf-8') ?? '').includes('get_session_manager')
      ) {
        nextSteps.push(
          `${filePath}: found ${sessionPath} but couldn't confirm the get_session_manager import — wire it into the StrandsAgent constructor manually.`,
        );
      }
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
