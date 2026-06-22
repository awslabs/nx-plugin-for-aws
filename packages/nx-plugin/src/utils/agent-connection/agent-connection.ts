/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import pyProjectGenerator, {
  getPyProjectDetails,
} from '../../py/project/generator';
import tsProjectGenerator from '../../ts/lib/generator';
import { addStarExport, applyGritQL, matchGritQL } from '../ast';
import { addDependenciesToPyProjectToml } from '../py';

/** Prefix a GritQL pattern with `language python` */
const py = (pattern: string) => `language python\n${pattern}`;

const AGENT_CONNECTION_DIR = 'agent-connection';
const PACKAGES_DIR = 'packages';
const COMMON_DIR = 'common';

export const AGENT_CONNECTION_PROJECT_DIR = joinPathFragments(
  PACKAGES_DIR,
  COMMON_DIR,
  AGENT_CONNECTION_DIR,
);

const PY_AGENT_CONNECTION_NAME = 'agent_connection';

/**
 * Get the directory of the shared Python agent-connection project.
 */
export function getPythonAgentConnectionProjectDir(tree: Tree): string {
  const { dir } = getPyProjectDetails(tree, {
    name: PY_AGENT_CONNECTION_NAME,
    directory: joinPathFragments(PACKAGES_DIR, COMMON_DIR),
  });
  return dir;
}

/**
 * Get the Python module name of the shared agent-connection project.
 */
export function getPythonAgentConnectionModuleName(tree: Tree): string {
  const { normalizedModuleName } = getPyProjectDetails(tree, {
    name: PY_AGENT_CONNECTION_NAME,
    directory: joinPathFragments(PACKAGES_DIR, COMMON_DIR),
  });
  return normalizedModuleName;
}

/**
 * Get the fully qualified Python package name of the shared agent-connection project.
 */
export function getPythonAgentConnectionPackageName(tree: Tree): string {
  const { fullyQualifiedName } = getPyProjectDetails(tree, {
    name: PY_AGENT_CONNECTION_NAME,
    directory: joinPathFragments(PACKAGES_DIR, COMMON_DIR),
  });
  return fullyQualifiedName;
}

/**
 * Directories (relative to this file) holding per-protocol core client
 * template files. Per-connection generators select which set to emit so
 * the MCP connection doesn't pull in the A2A client (or vice versa).
 */
export const TS_CORE_TEMPLATES = {
  mcp: 'core-mcp',
  a2a: 'core-a2a',
  gateway: 'core-gateway',
} as const;

export const PY_CORE_TEMPLATES = {
  mcp: 'py-core-mcp',
  a2a: 'py-core-a2a',
  gateway: 'py-core-gateway',
  /** Shared SigV4 `httpx.Auth` used by both MCP and A2A clients. */
  auth: 'py-core-auth',
} as const;

/**
 * Ensure the shared TypeScript agent-connection project exists and has the
 * shared core helpers (runtime-config loader). Per-connection generators
 * are responsible for emitting their own per-protocol core client templates.
 */
export async function ensureTypeScriptAgentConnectionProject(
  tree: Tree,
): Promise<void> {
  const projectJsonPath = joinPathFragments(
    AGENT_CONNECTION_PROJECT_DIR,
    'project.json',
  );
  if (!tree.exists(projectJsonPath)) {
    await tsProjectGenerator(tree, {
      name: AGENT_CONNECTION_DIR,
      directory: joinPathFragments(PACKAGES_DIR, COMMON_DIR),
    });
  }

  // Shared core helpers — emitted regardless of which per-protocol core
  // client the caller needs, so both MCP and A2A clients can import from them.
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'core-runtime-config'),
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'core'),
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Re-export session-context helpers so agent server entry points
  // can set the current session on each inbound request without pulling in
  // the agent-connection internals.
  await addStarExport(
    tree,
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'index.ts'),
    './core/session-context.js',
  );
  await addStarExport(
    tree,
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'index.ts'),
    './core/with-session-id.js',
  );
  await addStarExport(
    tree,
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'index.ts'),
    './core/model-errors.js',
  );
}

/**
 * Emit one of the TypeScript core client templates (mcp / a2a / gateway) into
 * the agent-connection project's `src/core/` directory. Safe to call multiple
 * times — `KeepExisting` preserves customised files.
 *
 * The MCP and gateway clients share the auth + transport helpers in
 * `core-shared`, so those are emitted alongside them.
 */
export function addTypeScriptCoreClient(
  tree: Tree,
  kind: keyof typeof TS_CORE_TEMPLATES,
): void {
  const coreDir = joinPathFragments(
    AGENT_CONNECTION_PROJECT_DIR,
    'src',
    'core',
  );
  if (kind === 'mcp' || kind === 'gateway') {
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'core-shared'),
      coreDir,
      {},
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );
  }
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', TS_CORE_TEMPLATES[kind]),
    coreDir,
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
}

/**
 * Ensure the shared Python agent-connection project exists.
 * Only creates the project shell — per-connection generators are responsible
 * for emitting their own core client templates.
 */
export async function ensurePythonAgentConnectionProject(
  tree: Tree,
): Promise<void> {
  const projectDir = getPythonAgentConnectionProjectDir(tree);
  const moduleName = getPythonAgentConnectionModuleName(tree);
  const projectJsonPath = joinPathFragments(projectDir, 'project.json');

  if (!tree.exists(projectJsonPath)) {
    // Create the Python project using the standard py#project generator
    await pyProjectGenerator(tree, {
      name: PY_AGENT_CONNECTION_NAME,
      directory: joinPathFragments(PACKAGES_DIR, COMMON_DIR),
      type: 'library',
    });
  }

  const moduleDir = joinPathFragments(projectDir, moduleName);

  // Ensure core/__init__.py exists
  const coreDir = joinPathFragments(moduleDir, 'core');
  if (!tree.exists(joinPathFragments(coreDir, '__init__.py'))) {
    tree.write(joinPathFragments(coreDir, '__init__.py'), '');
  }

  // Ensure app/__init__.py exists
  const appInitPath = joinPathFragments(moduleDir, 'app', '__init__.py');
  if (!tree.exists(appInitPath)) {
    tree.write(appInitPath, '');
  }

  // Shared core helpers — emitted regardless of which per-protocol core
  // client the caller needs, so both MCP and A2A clients can import them.
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'py-core-runtime-config'),
    coreDir,
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Re-export session-context helpers so agent server entry points
  // can set the current session on each inbound request without importing
  // the agent-connection internals directly.
  const moduleInitPath = joinPathFragments(moduleDir, '__init__.py');
  await addPythonReExport(
    tree,
    moduleInitPath,
    '.core.session_context',
    'get_current_session_id',
  );
  await addPythonReExport(
    tree,
    moduleInitPath,
    '.core.session_context',
    'session_id_context',
  );
  await addPythonReExport(
    tree,
    moduleInitPath,
    '.core.with_session_id',
    'with_session_id',
  );
  await addPythonReExport(
    tree,
    moduleInitPath,
    '.core.model_errors',
    'log_model_errors',
  );

  // Shared core helpers depend on aws-lambda-powertools for AppConfig access
  // and strands-agents for the model error-logging hook.
  addDependenciesToPyProjectToml(tree, projectDir, [
    'aws-lambda-powertools',
    'strands-agents',
  ]);
}

/**
 * Emit a Python core client template (mcp / a2a / gateway / shared auth) into
 * the agent-connection project's core directory.
 *
 * The MCP and gateway clients share the transport helpers in `py-core-shared`,
 * so those are emitted alongside them.
 */
export function addPythonCoreClient(
  tree: Tree,
  kind: keyof typeof PY_CORE_TEMPLATES,
): void {
  const projectDir = getPythonAgentConnectionProjectDir(tree);
  const moduleName = getPythonAgentConnectionModuleName(tree);
  const coreDir = joinPathFragments(projectDir, moduleName, 'core');
  if (kind === 'mcp' || kind === 'gateway') {
    generateFiles(
      tree,
      joinPathFragments(__dirname, 'files', 'py-core-shared'),
      coreDir,
      {},
      { overwriteStrategy: OverwriteStrategy.KeepExisting },
    );
  }
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', PY_CORE_TEMPLATES[kind]),
    coreDir,
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
}

/**
 * Patch a TypeScript agent.ts to create a connection client and register it
 * in the Agent's tools. Used by the MCP and gateway connection generators —
 * the client class must expose a static async `create()` returning a value
 * accepted by `Agent.tools` (e.g. an `McpClient`).
 */
export async function addTypeScriptClientToAgent(
  tree: Tree,
  agentFilePath: string,
  clientClassName: string,
  clientVarName: string,
): Promise<void> {
  const clientCreationStmt = `const ${clientVarName} = await ${clientClassName}.create();`;

  // Transform the arrow function that contains `new Agent`:
  // - Expression body: wrap in block with client creation and return
  // - Block body: prepend client creation statement
  await applyGritQL(
    tree,
    agentFilePath,
    `or { \`async ($p) => new Agent($args)\` => raw\`async ($p) => {
  ${clientCreationStmt}
  return new Agent($args);
}\` where { $program <: not contains \`${clientClassName}.create\` }, \`async ($p) => { $body }\` => raw\`async ($p) => {
  ${clientCreationStmt}
  $body
}\` where { $body <: contains \`new Agent($_)\`, $program <: not contains \`${clientClassName}.create\` } }`,
  );

  // Prepend the client to the tools array
  await applyGritQL(
    tree,
    agentFilePath,
    `\`tools: [$items]\` => \`tools: [${clientVarName}, $items]\` where { $items <: within \`new Agent($_)\`, $items <: not contains \`${clientVarName}\` }`,
  );
}

/**
 * Patch a Python agent.py to create a context-managed connection client,
 * enter it in the `with` block around `yield Agent(...)`, and spread its
 * `list_tools_sync()` into the Agent's tools. Used by the MCP and gateway
 * connection generators — the client class must expose a static `create()`
 * returning a context manager with `list_tools_sync()` (e.g. an `MCPClient`).
 */
export async function addPythonClientToAgent(
  tree: Tree,
  agentFilePath: string,
  clientClassName: string,
  clientVarName: string,
): Promise<void> {
  await addPythonClientTools(tree, agentFilePath, clientVarName);
  await addPythonClientToGetAgent(
    tree,
    agentFilePath,
    clientClassName,
    clientVarName,
  );
}

/**
 * Append `*<clientVarName>.list_tools_sync()` to the Agent's tools list.
 */
const addPythonClientTools = async (
  tree: Tree,
  filePath: string,
  clientVarName: string,
): Promise<void> => {
  if (
    await matchGritQL(
      tree,
      filePath,
      py(`\`${clientVarName}.list_tools_sync()\``),
    )
  ) {
    return;
  }

  await applyGritQL(
    tree,
    filePath,
    py(`\`tools=$old\` where {
  $old <: not contains \`${clientVarName}\`,
  if ($old <: \`[]\`) {
    $old => \`[*${clientVarName}.list_tools_sync()]\`
  } else {
    $old <: \`[$items]\` where { $items += \`, *${clientVarName}.list_tools_sync()\` }
  }
}`),
  );
};

/**
 * Create the client in get_agent and enter it in the `with` block.
 *
 * First connection: rewrites `def get_agent` to wrap the body in a with
 * block. Subsequent connections: adds to the existing with items and
 * prepends the creation line.
 */
const addPythonClientToGetAgent = async (
  tree: Tree,
  filePath: string,
  clientClassName: string,
  clientVarName: string,
): Promise<void> => {
  if (
    await matchGritQL(tree, filePath, py(`\`${clientClassName}.create()\``))
  ) {
    return;
  }

  // Try the "add to existing with block" pattern first.
  // If it succeeds, there was already a with block from a previous connection.
  const addedToWith = await applyGritQL(
    tree,
    filePath,
    py(`\`with ($items,): $body\` where {
  $items <: not contains \`${clientVarName}\`,
  $items += \`, ${clientVarName}\`
}`),
  );

  if (addedToWith) {
    // Subsequent connection — prepend the creation line to the function body
    // (a single anchor, so the line is inserted exactly once).
    await applyGritQL(
      tree,
      filePath,
      py(`\`def get_agent($params):
    $body\` where {
  $body <: contains \`yield Agent($_)\`,
  $body <: not contains \`${clientClassName}.create\`
} => \`def get_agent($params):
    ${clientVarName} = ${clientClassName}.create()
    $body\``),
    );
    return;
  }

  // First connection — wrap the existing `def get_agent` body in a single
  // `with (<var>,):` block.
  await applyGritQL(
    tree,
    filePath,
    py(`\`def get_agent($params):
    $body\` where {
  $body <: contains \`yield Agent($_)\`,
  $body <: not contains \`${clientClassName}.create\`
} => \`def get_agent($params):
    ${clientVarName} = ${clientClassName}.create()
    with (
        ${clientVarName},
    ):
        $body\``),
  );
};

/**
 * Add a re-export to the Python agent-connection module's __init__.py.
 * Equivalent to addStarExport for TS.
 * Uses `__all__` to mark re-exports as public (satisfies ruff F401).
 * Uses GritQL for AST-aware transforms where possible.
 */
export async function addPythonReExport(
  tree: Tree,
  initFilePath: string,
  fromModule: string,
  importName: string,
): Promise<void> {
  // Check if already exported
  if (await matchGritQL(tree, initFilePath, `\`${importName}\``)) {
    return;
  }

  const importLine = `from ${fromModule} import ${importName}`;
  const allEntry = `"${importName}"`;

  // If there's already an import from the same module, merge into its name list
  // (ruff I001 rejects two `from X import ...` lines for the same module).
  const mergedImport = await applyGritQL(
    tree,
    initFilePath,
    py(`\`from ${fromModule} import $names\` where {
  $names <: not contains \`${importName}\`,
  $names += \`, ${importName}\`
}`),
  );

  if (mergedImport) {
    await applyGritQL(
      tree,
      initFilePath,
      py(`\`__all__ = [$items]\` where { $items += \`, ${allEntry}\` }`),
    );
    return;
  }

  // Try to append import after existing import using +=
  const appendedImport = await applyGritQL(
    tree,
    initFilePath,
    py(
      `\`from $mod import $name\` as $stmt where {
  $program <: not contains \`${importName}\`,
  $stmt += \`\n${importLine}\`
}`,
    ),
  );

  if (appendedImport) {
    // Also append to existing __all__
    await applyGritQL(
      tree,
      initFilePath,
      py(`\`__all__ = [$items]\` where { $items += \`, ${allEntry}\` }`),
    );
    return;
  }

  // No existing imports — first re-export. Try to anchor after docstring.
  const anchoredImport = await applyGritQL(
    tree,
    initFilePath,
    py(
      `\`"""Automatically generated by Nx."""\` as $doc => \`$doc\n${importLine}\n\n__all__ = [${allEntry}]\``,
    ),
  );

  if (!anchoredImport) {
    // Completely empty file or no docstring — write directly
    tree.write(initFilePath, `${importLine}\n\n__all__ = [${allEntry}]\n`);
  }
}
