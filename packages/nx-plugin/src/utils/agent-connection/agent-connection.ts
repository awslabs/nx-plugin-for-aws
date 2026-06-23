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
import type { IPyDepVersion } from '../versions';

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
 * The connection protocols an agent framework can connect over. Each maps to a
 * framework-agnostic Layer-0/1 template directory plus a per-framework Layer-2
 * client directory (see `FRAMEWORKS`).
 */
export type ConnectionProtocol = 'mcp' | 'gateway' | 'a2a';

/**
 * The agent frameworks we can generate connection clients for. Adding a new
 * framework is an additive change: append an entry to `FRAMEWORKS` with its
 * Layer-2 template directories and dependencies — the framework-agnostic
 * Layer-0/1 (`core-auth`, `core-shared`, the per-protocol transports/configs)
 * is reused unchanged.
 */
export type AgentFramework = 'strands';

/**
 * Framework-agnostic Layer-1 templates, keyed by protocol. These resolve the
 * endpoint and build the signed transport/client-config; they contain no
 * framework dependency.
 */
const TS_PROTOCOL_TEMPLATES: Record<ConnectionProtocol, string> = {
  mcp: 'core-mcp',
  gateway: 'core-gateway',
  a2a: 'core-a2a',
};
const PY_PROTOCOL_TEMPLATES: Record<ConnectionProtocol, string> = {
  mcp: 'py-core-mcp',
  gateway: 'py-core-gateway',
  a2a: 'py-core-a2a',
};

/**
 * A framework's Layer-2 templates for one language. `base` holds the helpers
 * every connection of that framework needs (error logging, per-session agent
 * cache); `protocols` maps each *supported* protocol to the thin client that
 * wraps the matching Layer-1 transport/config in the framework's client type.
 *
 * A protocol absent from `protocols` is not supported by that framework in that
 * language — callers must check before emitting. `deps` are the extra package
 * dependencies the base + client templates require.
 */
interface FrameworkLanguageTemplates<Dep extends string> {
  base: string;
  protocols: Partial<Record<ConnectionProtocol, string>>;
  deps: Dep[];
}

/**
 * Per-framework Layer-2 templates. Support is asymmetric by design: a framework
 * may target only one language (`ts`/`py` is optional) and only a subset of
 * protocols. Adding a framework — or extending an existing one to a new
 * language/protocol — is an additive change to this registry.
 */
interface FrameworkTemplates {
  ts?: FrameworkLanguageTemplates<string>;
  py?: FrameworkLanguageTemplates<IPyDepVersion>;
}

const FRAMEWORKS: Record<AgentFramework, FrameworkTemplates> = {
  strands: {
    ts: {
      base: 'core-strands/base',
      protocols: {
        mcp: 'core-strands/mcp',
        gateway: 'core-strands/gateway',
        a2a: 'core-strands/a2a',
      },
      deps: [],
    },
    py: {
      base: 'py-core-strands/base',
      protocols: {
        mcp: 'py-core-strands/mcp',
        gateway: 'py-core-strands/gateway',
        a2a: 'py-core-strands/a2a',
      },
      deps: ['strands-agents'],
    },
  },
};

/** The frameworks that have connection support, derived from the registry. */
export const SUPPORTED_AGENT_FRAMEWORKS = Object.keys(
  FRAMEWORKS,
) as AgentFramework[];

/**
 * Whether a framework has connection support wired in for the given language.
 * Derived from the `FRAMEWORKS` registry — the single source of truth for
 * connection support — so the framework guard cannot drift from reality.
 */
export const frameworkSupportsLanguage = (
  framework: string,
  language: 'ts' | 'py',
): boolean =>
  Boolean(
    (FRAMEWORKS as Record<string, FrameworkTemplates>)[framework]?.[language],
  );

/**
 * The connection protocols a framework declares support for in a language,
 * read from the registry. Empty if the framework doesn't target the language.
 */
export const frameworkProtocols = (
  framework: AgentFramework,
  language: 'ts' | 'py',
): ConnectionProtocol[] => {
  const lang = FRAMEWORKS[framework][language];
  return lang ? (Object.keys(lang.protocols) as ConnectionProtocol[]) : [];
};

const languageLabel = (language: 'ts' | 'py') =>
  language === 'ts' ? 'TypeScript' : 'Python';

/**
 * Narrow an agent's recorded framework (a free-form string from component
 * metadata) to a known {@link AgentFramework}, or throw a clear not-supported
 * error. This is the single point that rejects a framework which exists in the
 * `py#agent`/`ts#agent` schema enum but has no connection support wired into
 * the `FRAMEWORKS` registry — so a forgotten framework throws cleanly here
 * instead of silently falling back to another framework's client.
 */
const resolveFramework = (
  framework: string,
  language: 'ts' | 'py',
): AgentFramework => {
  const lang = (FRAMEWORKS as Record<string, FrameworkTemplates>)[framework]?.[
    language
  ];
  if (!lang) {
    throw new Error(
      `The '${framework}' framework does not support ${languageLabel(language)} agents.`,
    );
  }
  return framework as AgentFramework;
};

/** Resolve a framework's templates for a language + protocol, or throw. */
function frameworkLanguage<L extends 'ts' | 'py'>(
  framework: string,
  language: L,
  protocol: ConnectionProtocol,
): NonNullable<FrameworkTemplates[L]> & { protocol: string } {
  const lang = FRAMEWORKS[resolveFramework(framework, language)][language];
  const protocolDir = lang!.protocols[protocol];
  if (!protocolDir) {
    throw new Error(
      `The '${framework}' framework does not support ${protocol} connections for ${languageLabel(language)} agents.`,
    );
  }
  return { ...lang, protocol: protocolDir } as NonNullable<
    FrameworkTemplates[L]
  > & { protocol: string };
}

/** Protocols whose Layer-1 needs the shared MCP transport (`core-shared`). */
const MCP_TRANSPORT_PROTOCOLS: ConnectionProtocol[] = ['mcp', 'gateway'];

const tsCoreDir = () =>
  joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'core');

const emitTs = (tree: Tree, templateDir: string) =>
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', templateDir),
    tsCoreDir(),
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

/**
 * Ensure the shared TypeScript agent-connection project exists and has the
 * framework-agnostic core helpers (runtime-config loader, session context).
 * Per-connection generators emit their own protocol + framework client
 * templates via `addTypeScriptCoreClient`.
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

  // Framework-agnostic runtime-config + session-context helpers.
  emitTs(tree, 'core-runtime-config');

  // Re-export session-context helpers so agent server entry points can set the
  // current session on each inbound request without pulling in internals.
  await addStarExport(
    tree,
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'index.ts'),
    './core/session-context.js',
  );
}

/**
 * Emit a framework's base Layer-2 helpers (model-error logging + per-session
 * agent cache) into the agent-connection project and re-export them. The agent
 * server entry point imports these regardless of whether any connection client
 * is wired in, so the agent generator calls this directly; connection
 * generators call it transitively via `addTypeScriptCoreClient`.
 */
export async function addTypeScriptFrameworkBase(
  tree: Tree,
  framework: string = 'strands',
): Promise<void> {
  const lang = FRAMEWORKS[resolveFramework(framework, 'ts')].ts!;
  emitTs(tree, lang.base);

  const indexPath = joinPathFragments(
    AGENT_CONNECTION_PROJECT_DIR,
    'src',
    'index.ts',
  );
  await addStarExport(tree, indexPath, './core/with-session-id-strands.js');
  await addStarExport(tree, indexPath, './core/model-errors-strands.js');
}

/**
 * Emit the TypeScript client templates for a connection protocol and agent
 * framework into the agent-connection project's `src/core/` directory. Safe to
 * call multiple times — `KeepExisting` preserves customised files.
 *
 * Layers emitted:
 *  - Layer 0 `core-auth` (signed fetch + endpoint resolution) — always
 *  - Layer 1 `core-shared` MCP transport — for mcp/gateway protocols
 *  - Layer 1 the protocol's transport/client-config — always
 *  - Layer 2 the framework's base helpers + protocol client — per framework
 */
export async function addTypeScriptCoreClient(
  tree: Tree,
  protocol: ConnectionProtocol,
  framework: string = 'strands',
): Promise<void> {
  const fw = frameworkLanguage(framework, 'ts', protocol);

  emitTs(tree, 'core-auth');
  if (MCP_TRANSPORT_PROTOCOLS.includes(protocol)) {
    emitTs(tree, 'core-shared');
  }
  emitTs(tree, TS_PROTOCOL_TEMPLATES[protocol]);

  // Framework Layer 2: base helpers (re-exported for the agent server) + the
  // thin protocol client.
  await addTypeScriptFrameworkBase(tree, framework);
  emitTs(tree, fw.protocol);
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

  // Framework-agnostic runtime-config + session-context helpers.
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', 'py-core-runtime-config'),
    coreDir,
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Re-export the session id context so agent server entry points can set the
  // current session on each inbound request without importing internals.
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

  // The runtime-config loader reads AppConfig via aws-lambda-powertools.
  addDependenciesToPyProjectToml(tree, projectDir, ['aws-lambda-powertools']);
}

const pyCoreDir = (tree: Tree) =>
  joinPathFragments(
    getPythonAgentConnectionProjectDir(tree),
    getPythonAgentConnectionModuleName(tree),
    'core',
  );

const emitPy = (tree: Tree, templateDir: string) =>
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files', templateDir),
    pyCoreDir(tree),
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

/**
 * Emit a framework's base Layer-2 helpers (model-error logging + per-session
 * agent cache) into the Python agent-connection project and re-export them.
 * The agent server entry point imports these regardless of whether a connection
 * client is wired in, so the agent generator calls this directly; connection
 * generators call it transitively via `addPythonCoreClient`.
 */
export async function addPythonFrameworkBase(
  tree: Tree,
  framework: string = 'strands',
): Promise<void> {
  const lang = FRAMEWORKS[resolveFramework(framework, 'py')].py!;
  emitPy(tree, lang.base);

  const moduleInitPath = joinPathFragments(
    getPythonAgentConnectionProjectDir(tree),
    getPythonAgentConnectionModuleName(tree),
    '__init__.py',
  );
  await addPythonReExport(
    tree,
    moduleInitPath,
    '.core.with_session_id_strands',
    'with_session_id',
  );
  await addPythonReExport(
    tree,
    moduleInitPath,
    '.core.model_errors_strands',
    'log_model_errors',
  );

  if (lang.deps.length > 0) {
    addDependenciesToPyProjectToml(
      tree,
      getPythonAgentConnectionProjectDir(tree),
      lang.deps,
    );
  }
}

/**
 * Emit the Python client templates for a connection protocol and agent
 * framework into the agent-connection project's core directory.
 *
 * Layers emitted:
 *  - Layer 0 `py-core-auth` (SigV4 httpx.Auth, session auth, endpoints) — always
 *  - Layer 1 `py-core-shared` MCP transport — for mcp/gateway protocols
 *  - Layer 1 the protocol's transport/client-config — always
 *  - Layer 2 the framework's base helpers + protocol client — per framework
 */
export async function addPythonCoreClient(
  tree: Tree,
  protocol: ConnectionProtocol,
  framework: string = 'strands',
): Promise<void> {
  const fw = frameworkLanguage(framework, 'py', protocol);

  emitPy(tree, 'py-core-auth');
  if (MCP_TRANSPORT_PROTOCOLS.includes(protocol)) {
    emitPy(tree, 'py-core-shared');
  }
  emitPy(tree, PY_PROTOCOL_TEMPLATES[protocol]);

  // Framework Layer 2: base helpers + the thin protocol client.
  await addPythonFrameworkBase(tree, framework);
  emitPy(tree, fw.protocol);
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
