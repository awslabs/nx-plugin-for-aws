/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type ProjectConfiguration,
  type Tree,
  visitNotIgnoredFiles,
} from '@nx/devkit';
import { TS_AGENT_GENERATOR_INFO } from '../../../ts/agent/generator.js';
import { AGENT_CONNECTION_PROJECT_DIR } from '../../../utils/agent-connection/agent-connection.js';
import {
  applyGritQL,
  captureGritQLVariable,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { isEsmWorkspace } from '../../../utils/module-format.js';
import { kebabCase } from '../../../utils/names.js';
import type { ComponentMetadata } from '../../../utils/nx.js';
import {
  getRelativePathToRootByDirectory,
  toProjectRelativePath,
} from '../../../utils/paths.js';

/**
 * Add session management support to ts#agent.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 *
 * Guardrails:
 * - Pattern-match before writing: skip files that have diverged from the shape
 *   your generators produce and report them via `nextSteps`, or consider a
 *   hybrid migration, rather than clobbering the user's changes.
 * - Idempotent: re-running must be a no-op.
 * - Format what you write: finish with `formatFilesInSubtree` so the files your
 *   migration wrote are formatted correctly.
 */

// Reshapes an `agentRuntimes` rc.set entry from a bare ARN to `{ arn }`. Only
// the 'agentcore' namespace — 'connection' (client-facing) stays a string,
// since it shouldn't carry the session bucket name to the browser. No
// `session` field added here; a fresh session.ts (created below) defaults to
// in-memory. Idempotent: only matches the pre-migration shape.
const CDK_RC_SET_PATTERN = `\`rc.set('agentcore', 'agentRuntimes', { ...rc.get('agentcore').agentRuntimes, $name: this.agentCoreRuntime.agentRuntimeArn });\` => raw\`rc.set('agentcore', 'agentRuntimes', {
  ...rc.get('agentcore').agentRuntimes,
  $name: {
    arn: this.agentCoreRuntime.agentRuntimeArn,
  },
});\``;

// Terraform equivalent, anchored on the module's fixed name/shape so it
// doesn't also match the 'connection' module's identical-looking `value` line.
const TF_VALUE_PATTERN = `language hcl\n\`module "add_agent_runtime_to_runtime_config" {
  source = "../../../core/runtime-config/entry"

  namespace = "agentcore"
  key       = "agentRuntimes"
  value     = { "$name" = module.agent_core_runtime.agent_core_runtime_arn }

  depends_on = [module.agent_core_runtime]
}\` => \`module "add_agent_runtime_to_runtime_config" {
  source = "../../../core/runtime-config/entry"

  namespace = "agentcore"
  key       = "agentRuntimes"
  value     = { "$name" = { arn = module.agent_core_runtime.agent_core_runtime_arn } }

  depends_on = [module.agent_core_runtime]
}\``;

// Shared `AgentCoreRuntimeConfig` interface, vended into
// `packages/common/agent-connection/src/core/runtime-config.ts`.
const TS_RUNTIME_CONFIG_INTERFACE_PATTERN = `\`export interface AgentCoreRuntimeConfig {
  agentRuntimes?: Record<string, string>;
  gateways?: Record<string, string>;
}\` => raw\`export interface AgentRuntimeEntry {
  arn: string;
  /** Session storage details. Only set when the agent has S3 session storage configured. */
  session?: {
    /** Name of the S3 bucket storing session data. */
    bucketName: string;
  };
}

export interface AgentCoreRuntimeConfig {
  agentRuntimes?: Record<string, AgentRuntimeEntry>;
  gateways?: Record<string, string>;
}\``;

// `config.agentRuntimes?.['Name']` as read by generated TS a2a/mcp clients and
// the agent-chat CLI. Idempotent via the `not contains ?.arn` guard.
const TS_CLIENT_ARN_PATTERNS = [
  '`config.agentRuntimes?.[$name]` => `config.agentRuntimes?.[$name]?.arn` where { $program <: not contains `config.agentRuntimes?.[$name]?.arn` }',
  '`config?.agentRuntimes?.[$name]` => `config?.agentRuntimes?.[$name]?.arn` where { $program <: not contains `config?.agentRuntimes?.[$name]?.arn` }',
];

// The agent-chat CLI's agentcore.ts calls `getAppConfig` directly rather than
// the shared `AgentCoreRuntimeConfig` type, so its own inline cast needs the
// same { arn } reshape TS_RUNTIME_CONFIG_INTERFACE_PATTERN gives the shared
// interface.
const AGENTCORE_CHAT_SCRIPT_TYPE_PATTERN =
  '`{ agentRuntimes?: Record<string, string> }` => `{ agentRuntimes?: Record<string, { arn: string }> }`';

// Python equivalent (Strands + LangChain client templates).
const PY_CLIENT_ARN_PATTERN =
  'language python\n`agent_runtime_arn = config.get("agentRuntimes", {}).get($name)` => `agent_runtime = config.get("agentRuntimes", {}).get($name)\nagent_runtime_arn = agent_runtime.get("arn") if agent_runtime else None`';

// Removes the imperative logModelErrors(agent)/logToolErrors(agent) calls.
// Required for AG-UI (its adapter clones the template agent per-thread, and
// hooks added directly to the template don't carry over — the equivalent
// behaviour is restored via the AGUI_INDEX_* plugins below). For HTTP/A2A
// it's a style unification, since the imperative form already worked there.
const AGENT_TS_LOG_MODEL_CALL_PATTERN = '`logModelErrors(agent);` => .';
const AGENT_TS_LOG_TOOL_CALL_PATTERN = '`logToolErrors(agent);` => .';

// HTTP/A2A agents build one Agent per session, so wiring `sessionManager`
// directly into the constructor is safe. Generic over `$props` so this works
// regardless of customised systemPrompt/tools, as long as it's an inline
// object literal. Prepended (not appended) to sidestep a trailing-comma
// double-comma when `$props` is captured as raw source text.
const AGENT_TS_SESSION_MANAGER_CONSTRUCTOR_PATTERN =
  '`new Agent({ $props })` => `new Agent({ sessionManager: await getSessionManager(), $props })` where { $props <: not contains `sessionManager` }';

// Match-only gate for the rewrites above/below: only applies when the Agent
// is an inline object literal, not e.g. a variable.
const AGENT_TS_CONSTRUCTOR_MATCH_PATTERN = '`new Agent({ $props })`';

// Moves the model/tool error hooks to Agent constructor plugins, mirroring
// the AG-UI rewrite for consistency (HTTP/A2A already worked with the
// imperative form).
const AGENT_TS_PLUGINS_CONSTRUCTOR_PATTERN =
  '`new Agent({ $props })` => `new Agent({ plugins: [new ModelErrorLoggingPlugin(), new ToolErrorLoggingPlugin()], $props })` where { $props <: not contains `plugins` }';

// Captures the agent-connection package specifier so the new imports (and the
// session.ts this migration creates) target the same module. Generic over
// `$names` since a connection generator may have merged its own import here.
const AGENT_TS_LOG_IMPORT_CAPTURE_PATTERN =
  "`import { $names } from '$mod';` where { $names <: contains `logModelErrors`, $names <: contains `logToolErrors` }";

// Removes `logModelErrors`/`logToolErrors` from the import, preserving any
// other merged specifiers (or the whole statement if none remain). Decomposed
// via `import_clause(name=named_imports($imports))` since a naive
// `$rest`-based rewrite silently fails once 2+ other specifiers are merged in.
const AGENT_TS_REMOVE_LOG_ERRORS_IMPORT_PATTERN =
  "`import $clause from '$mod';` as $import where { $clause <: import_clause(name=named_imports($imports)), $imports <: contains `logModelErrors`, $imports <: contains `logToolErrors`, if ($imports <: [`logModelErrors`, `logToolErrors`]) { $import => . } else { $imports <: some import_specifier(name=or { `logModelErrors`, `logToolErrors` }) => . } }";

// Existing agents predate session.ts, so there's no prior storage to
// preserve — default to in-memory.
const legacySessionManagerContent = (
  agentConnectionModule: string,
  localSessionsDir: string,
): string => `import { SessionManager } from '@strands-agents/sdk';
import { InMemoryStorage, LocalFileStorage } from '@strands-agents/sdk/storage';
import { getCurrentSessionId } from '${agentConnectionModule}';

/**
 * Returns a SessionManager for persisting conversation state across
 * invocations. Local development always uses local file storage for
 * convenience, regardless of the configured session option. Without a
 * configured session option, conversation state is kept in memory only and
 * does not survive process restarts.
 */
export const getSessionManager = async (): Promise<SessionManager> => {
  const sessionId = getCurrentSessionId();
  if (!sessionId) {
    throw new Error(
      'No current session id — cannot resolve a SessionManager outside of a request scope.',
    );
  }
  if (process.env.LOCAL_DEV === 'true') {
    return new SessionManager({
      sessionId,
      storage: new LocalFileStorage('${localSessionsDir}'),
    });
  }
  return new SessionManager({ sessionId, storage: new InMemoryStorage() });
};
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

/** This agent's own ComponentMetadata entry, as written by the ts#agent generator. */
const findAgentComponentMetadata = (
  project: ProjectConfiguration,
  dirRelativeToProjectRoot: string,
): ComponentMetadata | undefined =>
  (project.metadata as { components?: ComponentMetadata[] })?.components?.find(
    (component) =>
      component.generator === TS_AGENT_GENERATOR_INFO.id &&
      component.path === dirRelativeToProjectRoot,
  );

/** This agent's real kebab-case name, from ComponentMetadata's `rc` (class-name) field. */
const agentTmpNameFor = (
  project: ProjectConfiguration,
  dir: string,
): string | undefined => {
  const dirRelativeToProjectRoot = toProjectRelativePath(project, dir);
  const rc = findAgentComponentMetadata(project, dirRelativeToProjectRoot)?.rc;
  return rc ? kebabCase(rc) : undefined;
};

/** This agent's protocol, from ComponentMetadata's `protocol` field. */
const agentProtocolFor = (
  project: ProjectConfiguration,
  dir: string,
): string | undefined => {
  const dirRelativeToProjectRoot = toProjectRelativePath(project, dir);
  return findAgentComponentMetadata(project, dirRelativeToProjectRoot)
    ?.protocol;
};

/** The relative path from `projectRoot` up to this agent's workspace-root-level local session storage. */
const localSessionsDirFor = (
  projectRoot: string,
  agentTmpName: string,
): string =>
  joinPathFragments(
    getRelativePathToRootByDirectory(projectRoot),
    `tmp/agents/strands/${agentTmpName}`,
  );

// Wires ModelErrorLoggingPlugin/ToolErrorLoggingPlugin into the StrandsAgent
// constructor, restoring the error-logging behaviour removed from agent.ts.
const AGUI_INDEX_IMPORT_PATTERN =
  "`import { $names } from '$mod'` => `import { ModelErrorLoggingPlugin, ToolErrorLoggingPlugin, $names } from '$mod'` where { $names <: contains `runWithSessionId`, $names <: not contains `ModelErrorLoggingPlugin` }";
// Match-only form of the target shape, used to gate before touching the
// sibling agent.ts, and before committing to the rewrite here.
const AGUI_INDEX_CONSTRUCTOR_MATCH_PATTERN =
  '`new StrandsAgent({ agent, name: $name, description: $desc })`';
const AGUI_INDEX_CONSTRUCTOR_PATTERN = `${AGUI_INDEX_CONSTRUCTOR_MATCH_PATTERN} => \`new StrandsAgent({ agent, name: $name, description: $desc, plugins: [new ModelErrorLoggingPlugin(), new ToolErrorLoggingPlugin()] })\``;

const AGUI_INDEX_IMPORT_CAPTURE_PATTERN =
  "`import { $names } from '$mod';` where { $names <: contains `runWithSessionId` }";

// AG-UI's StrandsAgent adapter needs a sessionManagerProvider (called once
// per threadId), mirroring AGENT_TS_SESSION_MANAGER_CONSTRUCTOR_PATTERN.
const aguiIndexSessionManagerImportPattern = (esm: boolean) =>
  `\`import { getAgent } from '$mod';\` => raw\`import { getAgent } from '$mod';
import { getSessionManager } from './session${esm ? '.js' : ''}';\` where { $program <: not contains \`getSessionManager\` }`;
// Anchored on the exact 4-property shape produced above, so this only fires
// once plugins are wired in. Used both to gate and to rewrite.
const AGUI_INDEX_SESSION_MANAGER_MATCH_PATTERN =
  '`new StrandsAgent({ agent, name: $name, description: $desc, plugins: $plugins })`';
const AGUI_INDEX_SESSION_MANAGER_CONSTRUCTOR_PATTERN = `${AGUI_INDEX_SESSION_MANAGER_MATCH_PATTERN} => \`new StrandsAgent({ agent, name: $name, description: $desc, plugins: $plugins, config: { sessionManagerProvider: getSessionManager } })\``;

// The plugin classes referenced above only exist once model-errors-strands.ts
// / tool-errors-strands.ts are converted from their plain logXErrors function
// form (see checkPluginClass/applyPluginClass below). Anchored on the
// `agent.addHook(...)` call so this doesn't re-match its own output.
const MODEL_ERRORS_IMPORT_PATTERN =
  "`import { AfterModelCallEvent, type LocalAgent } from '@strands-agents/sdk';` => `import { AfterModelCallEvent, type LocalAgent, type Plugin } from '@strands-agents/sdk';`";
// Match-only form of the target shape, checked before committing to either
// this or the sibling tool-errors conversion — see checkPluginClass.
const MODEL_ERRORS_CLASS_MATCH_PATTERN =
  '`export const logModelErrors = (agent: LocalAgent): void => { agent.addHook(AfterModelCallEvent, $callback); };`';
const MODEL_ERRORS_CLASS_PATTERN = `${MODEL_ERRORS_CLASS_MATCH_PATTERN} => raw\`export class ModelErrorLoggingPlugin implements Plugin {\n  readonly name = 'model-error-logging';\n\n  initAgent(agent: LocalAgent): void {\n    agent.addHook(AfterModelCallEvent, $callback);\n  }\n}\``;

const TOOL_ERRORS_IMPORT_PATTERN =
  "`import { AfterToolCallEvent, type LocalAgent, TextBlock } from '@strands-agents/sdk';` => `import { AfterToolCallEvent, type LocalAgent, type Plugin, TextBlock } from '@strands-agents/sdk';`";
const TOOL_ERRORS_CLASS_MATCH_PATTERN =
  '`export const logToolErrors = (agent: LocalAgent): void => { agent.addHook(AfterToolCallEvent, $callback); };`';
const TOOL_ERRORS_CLASS_PATTERN = `${TOOL_ERRORS_CLASS_MATCH_PATTERN} => raw\`export class ToolErrorLoggingPlugin implements Plugin {\n  readonly name = 'tool-error-logging';\n\n  initAgent(agent: LocalAgent): void {\n    agent.addHook(AfterToolCallEvent, $callback);\n  }\n}\``;

type PluginClassStatus = 'ready' | 'done' | 'diverged';

/**
 * Checks (without writing) whether `filePath` still needs converting from its
 * plain `logXErrors` function to `className`, and whether the conversion
 * pattern would actually apply. `'done'` covers both "already converted" and
 * "file doesn't exist" — either way there's nothing to do and nothing
 * blocking the sibling conversion.
 */
async function checkPluginClass(
  tree: Tree,
  filePath: string,
  className: string,
  classMatchPattern: string,
): Promise<PluginClassStatus> {
  if (!tree.exists(filePath)) {
    return 'done';
  }
  if ((tree.read(filePath, 'utf-8') ?? '').includes(`class ${className}`)) {
    return 'done';
  }
  return (await matchGritQL(tree, filePath, classMatchPattern))
    ? 'ready'
    : 'diverged';
}

/** Applies the class + import rewrite for a file already confirmed `'ready'`. */
async function applyPluginClass(
  tree: Tree,
  filePath: string,
  importPattern: string,
  classPattern: string,
): Promise<void> {
  // The class rewrite is applied first, and the import only added once it's
  // confirmed to have actually happened here — not because either could fail
  // at this point (checkPluginClass already confirmed the pattern matches),
  // but to keep this file's own edit order self-evidently safe to read.
  await applyGritQL(tree, filePath, classPattern);
  await applyGritQL(tree, filePath, importPattern);
}

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];
  let anyChanges = false;

  // Both classes live in one shared agent-connection package, so their
  // readiness is resolved once up front rather than per agent.
  const modelErrorsPath = joinPathFragments(
    AGENT_CONNECTION_PROJECT_DIR,
    'src',
    'core',
    'model-errors-strands.ts',
  );
  const toolErrorsPath = joinPathFragments(
    AGENT_CONNECTION_PROJECT_DIR,
    'src',
    'core',
    'tool-errors-strands.ts',
  );
  // Checked together, before writing either: all-or-nothing, so a run either
  // converts both or leaves both untouched — never just one.
  const modelPluginStatus = await checkPluginClass(
    tree,
    modelErrorsPath,
    'ModelErrorLoggingPlugin',
    MODEL_ERRORS_CLASS_MATCH_PATTERN,
  );
  const toolPluginStatus = await checkPluginClass(
    tree,
    toolErrorsPath,
    'ToolErrorLoggingPlugin',
    TOOL_ERRORS_CLASS_MATCH_PATTERN,
  );
  const pluginsReady =
    modelPluginStatus !== 'diverged' && toolPluginStatus !== 'diverged';

  if (pluginsReady) {
    if (modelPluginStatus === 'ready') {
      await applyPluginClass(
        tree,
        modelErrorsPath,
        MODEL_ERRORS_IMPORT_PATTERN,
        MODEL_ERRORS_CLASS_PATTERN,
      );
    }
    if (toolPluginStatus === 'ready') {
      await applyPluginClass(
        tree,
        toolErrorsPath,
        TOOL_ERRORS_IMPORT_PATTERN,
        TOOL_ERRORS_CLASS_PATTERN,
      );
    }
  } else {
    if (modelPluginStatus === 'diverged') {
      nextSteps.push(
        `${modelErrorsPath}: diverged from the generated shape - left as-is. Manually convert it to a \`ModelErrorLoggingPlugin\` class implementing \`Plugin\` (see the ts#agent generator's template); agent.ts/index.ts files that reference it are left unmigrated until both this and ${toolErrorsPath} are converted.`,
      );
    }
    if (toolPluginStatus === 'diverged') {
      nextSteps.push(
        `${toolErrorsPath}: diverged from the generated shape - left as-is. Manually convert it to a \`ToolErrorLoggingPlugin\` class implementing \`Plugin\` (see the ts#agent generator's template); agent.ts/index.ts files that reference it are left unmigrated until both this and ${modelErrorsPath} are converted.`,
      );
    }
  }

  const filePaths: string[] = [];
  visitNotIgnoredFiles(tree, '', (filePath) => filePaths.push(filePath));

  for (const filePath of filePaths) {
    if (filePath === modelErrorsPath || filePath === toolErrorsPath) {
      continue;
    }
    if (filePath.endsWith('.d.ts')) {
      continue;
    }

    // session.ts already targets the new { arn, session } shape via
    // `config.agentRuntimes?.[$name]?.session?.bucketName` — the generic
    // reshape branch below would otherwise corrupt that into `?.arn?.session?.bucketName`.
    if (filePath.endsWith('/session.ts')) {
      continue;
    }

    if (filePath.endsWith('/agent.ts')) {
      const dir = filePath.split('/').slice(0, -1).join('/');
      const project = findOwningProject(tree, dir);

      // Without a registered project there's no ComponentMetadata, so this
      // agent's protocol/name/agent-connection module can't be resolved — and
      // a pre-migration AG-UI agent.ts is textually identical to an
      // HTTP/A2A one, so there's nothing left to safely guess from.
      if (!project) {
        if (
          await matchGritQL(tree, filePath, AGENT_TS_LOG_IMPORT_CAPTURE_PATTERN)
        ) {
          nextSteps.push(
            `${filePath}: could not determine the project root — manually verify whether this is an AG-UI or HTTP/A2A agent and complete its session-manager/error-logging-plugin migration accordingly (see the ts#agent generator's template).`,
          );
        }
        continue;
      }

      const protocol = agentProtocolFor(project, dir);

      if (protocol === 'ag-ui') {
        const hasLogCalls =
          (await matchGritQL(
            tree,
            filePath,
            AGENT_TS_LOG_MODEL_CALL_PATTERN,
          )) ||
          (await matchGritQL(tree, filePath, AGENT_TS_LOG_TOOL_CALL_PATTERN));
        if (!hasLogCalls) {
          continue;
        }

        // The sibling index.ts restores error-logging via StrandsAgent
        // plugins — removing the calls here without that succeeding would
        // drop error logging rather than move it.
        const indexPath = `${dir}/index.ts`;
        const indexReady =
          pluginsReady &&
          (await matchGritQL(
            tree,
            indexPath,
            AGUI_INDEX_CONSTRUCTOR_MATCH_PATTERN,
          ));

        if (!indexReady) {
          nextSteps.push(
            `${filePath}: left the logModelErrors/logToolErrors calls in place — ${indexPath} could not be automatically wired with the equivalent StrandsAgent plugins. Move error logging to plugins there manually (see the ts#agent generator's template), then remove these calls.`,
          );
          continue;
        }

        const rewroteImport = await applyGritQL(
          tree,
          filePath,
          AGENT_TS_REMOVE_LOG_ERRORS_IMPORT_PATTERN,
        );
        const rewroteModelCall = await applyGritQL(
          tree,
          filePath,
          AGENT_TS_LOG_MODEL_CALL_PATTERN,
        );
        const rewroteToolCall = await applyGritQL(
          tree,
          filePath,
          AGENT_TS_LOG_TOOL_CALL_PATTERN,
        );
        if (rewroteImport || rewroteModelCall || rewroteToolCall) {
          anyChanges = true;
        }
        continue;
      }

      if (!protocol) {
        if (
          await matchGritQL(tree, filePath, AGENT_TS_LOG_IMPORT_CAPTURE_PATTERN)
        ) {
          nextSteps.push(
            `${filePath}: could not determine this agent's protocol from its ComponentMetadata — manually verify whether it's AG-UI or HTTP/A2A and wire sessionManager/the error-logging plugins in accordingly (see the ts#agent generator's template).`,
          );
        }
        continue;
      }

      // HTTP/A2A: wire sessionManager into the Agent constructor and create
      // the sibling session.ts if it doesn't exist yet.
      if (
        !(await matchGritQL(
          tree,
          filePath,
          AGENT_TS_LOG_IMPORT_CAPTURE_PATTERN,
        ))
      ) {
        continue;
      }

      const sessionPath = `${dir}/session.ts`;

      // Checked before any writes: if the plugin classes aren't available, or
      // the Agent isn't an inline object literal, leave the file untouched
      // entirely rather than ending up half-migrated.
      if (!pluginsReady) {
        nextSteps.push(
          `${filePath}: left as-is — ModelErrorLoggingPlugin/ToolErrorLoggingPlugin are not available yet (see the model-errors-strands.ts/tool-errors-strands.ts next step above). Wire sessionManager and the plugins in manually once those classes exist.`,
        );
        continue;
      }
      if (
        !(await matchGritQL(tree, filePath, AGENT_TS_CONSTRUCTOR_MATCH_PATTERN))
      ) {
        nextSteps.push(
          `${filePath}: the Agent is not constructed with an inline object literal (\`new Agent({ ... })\`), so sessionManager and the error-logging plugins could not be wired in automatically. Manually add \`sessionManager: await getSessionManager()\` and \`plugins: [new ModelErrorLoggingPlugin(), new ToolErrorLoggingPlugin()]\` to its constructor (see the ts#agent generator's template), creating ${sessionPath} first if it doesn't already exist.`,
        );
        continue;
      }

      if (!tree.exists(sessionPath)) {
        const mod = await captureGritQLVariable(
          tree,
          filePath,
          AGENT_TS_LOG_IMPORT_CAPTURE_PATTERN,
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
            `${filePath}: could not determine the agent-connection module or this agent's name from its ComponentMetadata — manually create a session.ts (see the ts#agent generator's template) and wire \`sessionManager: await getSessionManager()\` into the Agent constructor.`,
          );
          continue;
        }
      }

      // Merges the plugin imports into the existing logModelErrors/
      // logToolErrors import clause (rather than a redundant second import),
      // and adds getSessionManager as its own line. The old specifiers are
      // stripped separately below, after this rewrite anchors on them.
      const esm = isEsmWorkspace(tree);
      await applyGritQL(
        tree,
        filePath,
        `\`import { $names } from '$mod';\` => raw\`import { ModelErrorLoggingPlugin, ToolErrorLoggingPlugin, $names } from '$mod';
import { getSessionManager } from './session${esm ? '.js' : ''}';\` where { $names <: contains \`logModelErrors\`, $names <: contains \`logToolErrors\`, $program <: not contains \`getSessionManager\` }`,
      );

      // Only rewrite the constructor once the import is confirmed present.
      if (!(tree.read(filePath, 'utf-8') ?? '').includes('getSessionManager')) {
        nextSteps.push(
          `${filePath}: found ${sessionPath} but couldn't confirm the getSessionManager import — wire \`sessionManager: await getSessionManager()\` into the Agent constructor manually.`,
        );
        continue;
      }

      await applyGritQL(tree, filePath, AGENT_TS_LOG_MODEL_CALL_PATTERN);
      await applyGritQL(tree, filePath, AGENT_TS_LOG_TOOL_CALL_PATTERN);
      await applyGritQL(
        tree,
        filePath,
        AGENT_TS_REMOVE_LOG_ERRORS_IMPORT_PATTERN,
      );

      const rewrotePlugins = await applyGritQL(
        tree,
        filePath,
        AGENT_TS_PLUGINS_CONSTRUCTOR_PATTERN,
      );
      const rewroteConstructor = await applyGritQL(
        tree,
        filePath,
        AGENT_TS_SESSION_MANAGER_CONSTRUCTOR_PATTERN,
      );
      if (rewrotePlugins || rewroteConstructor) {
        anyChanges = true;
      }
      continue;
    }

    if (
      filePath.endsWith('/index.ts') &&
      (tree.read(filePath, 'utf-8') ?? '').includes('@ag-ui/aws-strands')
    ) {
      const alreadyWired = (tree.read(filePath, 'utf-8') ?? '').includes(
        'ModelErrorLoggingPlugin',
      );

      if (!alreadyWired) {
        // Import and constructor only apply cleanly together — adding the
        // import while the constructor can't be rewritten would leave an
        // unused import and no plugins wired in.
        const needsPluginWiring = await matchGritQL(
          tree,
          filePath,
          AGUI_INDEX_CONSTRUCTOR_MATCH_PATTERN,
        );
        if (!pluginsReady) {
          if (needsPluginWiring) {
            nextSteps.push(
              `${filePath}: left the StrandsAgent constructor as-is — ModelErrorLoggingPlugin/ToolErrorLoggingPlugin are not available yet (see the model-errors-strands.ts/tool-errors-strands.ts next step above). Wire them in manually once those classes exist.`,
            );
          }
          continue;
        }
        if (!needsPluginWiring) {
          nextSteps.push(
            `${filePath}: the StrandsAgent constructor has diverged from the generated shape - left as-is. Manually add \`plugins: [new ModelErrorLoggingPlugin(), new ToolErrorLoggingPlugin()]\` to it (see the ts#agent generator's template).`,
          );
          continue;
        }

        const rewroteImport = await applyGritQL(
          tree,
          filePath,
          AGUI_INDEX_IMPORT_PATTERN,
        );
        const rewroteConstructor = await applyGritQL(
          tree,
          filePath,
          AGUI_INDEX_CONSTRUCTOR_PATTERN,
        );
        if (rewroteImport || rewroteConstructor) {
          anyChanges = true;
        }
      }

      // Create the sibling session.ts (once plugins are present) and wire in
      // sessionManagerProvider. Gated on the exact post-plugins shape, so a
      // customised constructor is left alone rather than creating an unused
      // session.ts.
      if (
        !(await matchGritQL(
          tree,
          filePath,
          AGUI_INDEX_SESSION_MANAGER_MATCH_PATTERN,
        ))
      ) {
        continue;
      }

      const dir = filePath.split('/').slice(0, -1).join('/');
      const sessionPath = `${dir}/session.ts`;

      if (!tree.exists(sessionPath)) {
        const project = findOwningProject(tree, dir);
        const mod = await captureGritQLVariable(
          tree,
          filePath,
          AGUI_INDEX_IMPORT_CAPTURE_PATTERN,
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
            `${filePath}: could not determine the project root, agent-connection module, or this agent's name from its ComponentMetadata — manually create a session.ts (see the ts#agent generator's template) and wire \`config: { sessionManagerProvider: getSessionManager }\` into the StrandsAgent constructor.`,
          );
          continue;
        }
      }

      const esm = isEsmWorkspace(tree);
      await applyGritQL(
        tree,
        filePath,
        aguiIndexSessionManagerImportPattern(esm),
      );

      if (!(tree.read(filePath, 'utf-8') ?? '').includes('getSessionManager')) {
        nextSteps.push(
          `${filePath}: found ${sessionPath} but couldn't confirm the getSessionManager import — wire \`config: { sessionManagerProvider: getSessionManager }\` into the StrandsAgent constructor manually.`,
        );
        continue;
      }

      const rewroteSessionManagerConstructor = await applyGritQL(
        tree,
        filePath,
        AGUI_INDEX_SESSION_MANAGER_CONSTRUCTOR_PATTERN,
      );
      if (rewroteSessionManagerConstructor) {
        anyChanges = true;
      }
      continue;
    }

    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      const contents = tree.read(filePath, 'utf-8') ?? '';
      if (!contents.includes('agentRuntimes')) {
        continue;
      }
      // Only the 'agentcore' namespace is reshaped — see CDK_RC_SET_PATTERN.
      const rewroteAgentcoreRcSet = await applyGritQL(
        tree,
        filePath,
        CDK_RC_SET_PATTERN,
      );
      const rewroteInterface = await applyGritQL(
        tree,
        filePath,
        TS_RUNTIME_CONFIG_INTERFACE_PATTERN,
      );
      let rewroteClientArn = false;
      for (const pattern of TS_CLIENT_ARN_PATTERNS) {
        rewroteClientArn = (await applyGritQL(tree, filePath, pattern))
          ? true
          : rewroteClientArn;
      }
      const rewroteChatScriptType = await applyGritQL(
        tree,
        filePath,
        AGENTCORE_CHAT_SCRIPT_TYPE_PATTERN,
      );

      if (
        rewroteAgentcoreRcSet ||
        rewroteInterface ||
        rewroteClientArn ||
        rewroteChatScriptType
      ) {
        anyChanges = true;
      }
    } else if (filePath.endsWith('.tf')) {
      const contents = tree.read(filePath, 'utf-8') ?? '';
      if (!contents.includes('"agentRuntimes"')) {
        continue;
      }
      const rewrote = await applyGritQL(tree, filePath, TF_VALUE_PATTERN);
      if (rewrote) {
        anyChanges = true;
      }
    } else if (filePath.endsWith('.py')) {
      const contents = tree.read(filePath, 'utf-8') ?? '';
      if (!contents.includes('agentRuntimes')) {
        continue;
      }
      const rewrote = await applyGritQL(tree, filePath, PY_CLIENT_ARN_PATTERN);
      if (rewrote) {
        anyChanges = true;
      }
    }
  }

  if (anyChanges) {
    nextSteps.push(
      'If you have custom code reading the runtime config `agentcore.agentRuntimes` entries ' +
        'as plain ARN strings (e.g. custom Lambda handlers or agent code), update it to read ' +
        'the ARN from `.arn` on the new `{ arn }` shape.',
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
