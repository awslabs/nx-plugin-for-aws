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
import { applyGritQL, captureGritQL, matchGritQL } from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import { isEsmWorkspace } from '../../../utils/module-format';
import { kebabCase } from '../../../utils/names';

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

// Existing agents predate session management support, so migrate them to
// 'in-memory' rather than opting them into a persisted session behind their
// back. MCP servers have no session regardless.
const LEGACY_SESSION_STORAGE = 'in-memory';

// Matches `rc.set('<namespace>', 'agentRuntimes', { ...rc.get('<namespace>').agentRuntimes, $name: this.agentCoreRuntime.agentRuntimeArn });`
// as vended by the CDK agent-core construct (for both the 'agentcore' and the
// connection-generator-patched 'connection' namespace). Naturally idempotent:
// once migrated, `$name`'s value is a `{ arn, session }` object rather than
// `this.agentCoreRuntime.agentRuntimeArn` directly, so this no longer matches.
const cdkRcSetPattern = (namespace: 'agentcore' | 'connection') =>
  `\`rc.set('${namespace}', 'agentRuntimes', { ...rc.get('${namespace}').agentRuntimes, $name: this.agentCoreRuntime.agentRuntimeArn });\` => raw\`rc.set('${namespace}', 'agentRuntimes', {
  ...rc.get('${namespace}').agentRuntimes,
  $name: {
    arn: this.agentCoreRuntime.agentRuntimeArn,
    session: { storage: '${LEGACY_SESSION_STORAGE}' },
  },
});\``;

// Matches the equivalent `value = { "$name" = module.agent_core_runtime.agent_core_runtime_arn }`
// line as vended by the Terraform agent-core construct, for both the
// 'agentcore' and connection-generator-patched 'connection' modules. Naturally
// idempotent (see cdkRcSetPattern).
const TF_VALUE_PATTERN = `language hcl\n\`value     = { "$name" = module.agent_core_runtime.agent_core_runtime_arn }\` => \`value     = { "$name" = { arn = module.agent_core_runtime.agent_core_runtime_arn, session = { storage = "${LEGACY_SESSION_STORAGE}" } } }\``;

// Exact shape of the shared `AgentCoreRuntimeConfig` interface prior to this
// change, as vended into `packages/common/agent-connection/src/core/runtime-config.ts`.
const TS_RUNTIME_CONFIG_INTERFACE_PATTERN = `\`export interface AgentCoreRuntimeConfig {
  agentRuntimes?: Record<string, string>;
  gateways?: Record<string, string>;
}\` => raw\`export interface AgentRuntimeSession {
  storage: 's3' | 'in-memory';
  /** Name of the S3 bucket storing session data. Only set when storage is 's3'. */
  bucketName?: string;
}

export interface AgentRuntimeEntry {
  arn: string;
  session: AgentRuntimeSession;
}

export interface AgentCoreRuntimeConfig {
  agentRuntimes?: Record<string, AgentRuntimeEntry>;
  gateways?: Record<string, string>;
}\``;

// Matches `config.agentRuntimes?.['Name']` / `config?.agentRuntimes?.['Name']`
// as read by the generated TS a2a/mcp client and agent-chat CLI templates.
// The `where` clause guards idempotency: once `?.arn` is appended, the
// program no longer matches the bare pre-`.arn` form so this doesn't re-fire.
const TS_CLIENT_ARN_PATTERNS = [
  '`config.agentRuntimes?.[$name]` => `config.agentRuntimes?.[$name]?.arn` where { $program <: not contains `config.agentRuntimes?.[$name]?.arn` }',
  '`config?.agentRuntimes?.[$name]` => `config?.agentRuntimes?.[$name]?.arn` where { $program <: not contains `config?.agentRuntimes?.[$name]?.arn` }',
];

// Matches `agent_runtime_arn = config.get("agentRuntimes", {}).get($name)` as
// read by the generated Python a2a/mcp client templates (Strands + LangChain).
const PY_CLIENT_ARN_PATTERN =
  'language python\n`agent_runtime_arn = config.get("agentRuntimes", {}).get($name)` => `agent_runtime = config.get("agentRuntimes", {}).get($name)\nagent_runtime_arn = agent_runtime.get("arn") if agent_runtime else None`';

// Matches the `$val.startsWith('arn:') ? $fn($val) : $val` duck-typing used by
// the generated React trpc/AG-UI/OpenAPI client providers to distinguish a
// deployed runtime ARN from a local-dev override URL. Generic over the
// value/build-function identifiers so it covers all three providers.
// Naturally idempotent (the rewritten form no longer contains `.startsWith('arn:')`).
const REACT_DUCK_TYPING_PATTERN =
  "`$val.startsWith('arn:') ? $fn($val) : $val` => `typeof $val === 'string' ? $val : $fn($val.arn)`";

// AG-UI's adapter clones the template agent per-thread, but hooks added
// directly to the template (as logModelErrors/logToolErrors do) are NOT
// carried over onto those clones, so the per-thread agents would silently
// run without error logging. Removes the (AG-UI-incompatible) import and
// calls from an existing agent.ts — the equivalent behaviour is restored via
// AGUI_INDEX_*_PATTERN below, which wires the same logic in as StrandsAgent
// plugins instead (plugins are applied to each per-thread agent via
// initAgent). Naturally idempotent (nothing to match once removed). The
// import itself is removed via removeLogErrorsImport below (see its comment
// for why a plain GritQL rewrite can't express this).
const AGENT_TS_LOG_MODEL_CALL_PATTERN = '`logModelErrors(agent);` => .';
const AGENT_TS_LOG_TOOL_CALL_PATTERN = '`logToolErrors(agent);` => .';

// AG-UI is the only protocol whose index.ts imports from '@ag-ui/aws-strands'
// (see files/ag-ui/index.ts.template), so that's a reliable signal that the
// sibling agent.ts belongs to an AG-UI agent.
const isAgUiAgentDir = (tree: Tree, agentTsPath: string): boolean => {
  const dir = agentTsPath.split('/').slice(0, -1).join('/');
  const indexTsPath = `${dir}/index.ts`;
  const indexContents = tree.read(indexTsPath, 'utf-8') ?? '';
  return indexContents.includes('@ag-ui/aws-strands');
};

// HTTP/A2A agents (unlike AG-UI) construct one Agent per session via
// `withSessionId(getAgent)`, so wiring `sessionManager` directly into
// `getAgent`'s `new Agent({ ... })` call is safe. Generic over `$props`
// (the object literal's own property list) so this applies regardless of how
// the user has customised systemPrompt/tools — only requires the props to be
// passed as an inline object literal (not a variable). `sessionManager` is
// prepended rather than appended: `$props` is captured as raw source text and
// commonly ends with prettier's trailing comma, so appending `, sessionManager: ...`
// after it would produce a double comma (invalid syntax); prepending before
// `$props` sidesteps that entirely, and `formatFilesInSubtree` reformats the
// result cleanly regardless of property order. Naturally idempotent via the
// `not contains sessionManager` guard.
const AGENT_TS_SESSION_MANAGER_CONSTRUCTOR_PATTERN =
  '`new Agent({ $props })` => `new Agent({ sessionManager: await getSessionManager(), $props })` where { $props <: not contains `sessionManager` }';

// Captures the agent-connection package specifier from the existing
// logModelErrors/logToolErrors import so the new getSessionManager import
// (and the fresh session.ts this migration creates) target the same
// module, without needing to know the workspace's npm scope directly. Generic
// over `$names` (rather than requiring an exact 2-specifier import) since a
// connection generator (mcp-connection/a2a-connection) may have merged its
// own client import into this same statement via addDestructuredImport.
const AGENT_TS_LOG_IMPORT_CAPTURE_PATTERN =
  "`import { $names } from '$mod';` where { $names <: contains `logModelErrors`, $names <: contains `logToolErrors` }";

// Removes `logModelErrors`/`logToolErrors` from the import, preserving any
// other specifiers a connection generator has merged into the same statement
// (or removing the whole statement if none remain). A naive rewrite like
// `import { logModelErrors, logToolErrors, $rest } from '$mod'` can't express
// this: `$rest` binds a *fixed* number of sibling nodes and silently fails to
// match once 2+ other specifiers are merged in (verified — it works for
// exactly 1 remaining specifier, not 2+). Decomposing via
// `import_clause(name=named_imports($imports))` instead exposes `$imports`
// as an actual GritQL list, so `some import_specifier(name=or {...}) => .`
// can delete each matching specifier individually regardless of how many
// others remain or what order they're in; deletes the whole import only when
// the list is exactly the two of them.
const AGENT_TS_REMOVE_LOG_ERRORS_IMPORT_PATTERN =
  "`import $clause from '$mod';` as $import where { $clause <: import_clause(name=named_imports($imports)), $imports <: contains `logModelErrors`, $imports <: contains `logToolErrors`, if ($imports <: [`logModelErrors`, `logToolErrors`]) { $import => . } else { $imports <: some import_specifier(name=or { `logModelErrors`, `logToolErrors` }) => . } }";

// Existing agents predate session.ts entirely, so there is no prior
// session storage to preserve here — this mirrors LEGACY_SESSION_STORAGE ('in-memory').
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

/** The root and name of the Nx project owning `dirPath`, if any. */
const findOwningProject = (
  tree: Tree,
  dirPath: string,
): { root: string; name: string } | undefined => {
  let best: { root: string; name: string } | undefined;
  for (const project of getProjects(tree).values()) {
    if (
      (dirPath === project.root || dirPath.startsWith(`${project.root}/`)) &&
      (!best || project.root.length > best.root.length)
    ) {
      best = { root: project.root, name: project.name ?? project.root };
    }
  }
  return best;
};

// Mirrors the ts#agent generator's own default-name formula (`<project>-agent`
// when no custom name is given, else the custom name directly) so migrated
// agents land in the same per-agent folder a fresh generate would produce.
// `dirName` is the agent's source directory name (e.g. `agent` for the
// default, or the custom kebab-case name the user passed to the generator).
const agentTmpNameFor = (projectName: string, dirName: string): string => {
  const lastSegment = projectName.split('/').pop() ?? projectName;
  return dirName === 'agent' ? `${kebabCase(lastSegment)}-agent` : dirName;
};

/** The relative path from `projectRoot` up to this agent's workspace-root-level local session storage. */
const localSessionsDirFor = (
  projectRoot: string,
  agentTmpName: string,
): string => {
  const depth = projectRoot.split('/').filter(Boolean).length;
  return joinPathFragments(
    Array(depth).fill('..').join('/'),
    `tmp/agents/strands/${agentTmpName}`,
  );
};

// Adds the ModelErrorLoggingPlugin/ToolErrorLoggingPlugin import (generic over
// the agent-connection package's npm scope) and wires them into the
// StrandsAgent constructor, restoring the error-logging behaviour removed
// from agent.ts above. Naturally idempotent.
const AGUI_INDEX_IMPORT_PATTERN =
  "`import { $names } from '$mod'` => `import { ModelErrorLoggingPlugin, ToolErrorLoggingPlugin, $names } from '$mod'` where { $names <: contains `runWithSessionId`, $names <: not contains `ModelErrorLoggingPlugin` }";
const AGUI_INDEX_CONSTRUCTOR_PATTERN =
  '`new StrandsAgent({ agent, name: $name, description: $desc })` => `new StrandsAgent({ agent, name: $name, description: $desc, plugins: [new ModelErrorLoggingPlugin(), new ToolErrorLoggingPlugin()] })`';

// Captures the same agent-connection package specifier via index.ts's
// existing runWithSessionId import, for the same reason as
// AGENT_TS_LOG_IMPORT_CAPTURE_PATTERN above.
const AGUI_INDEX_IMPORT_CAPTURE_PATTERN =
  "`import { $names } from '$mod';` where { $names <: contains `runWithSessionId` }";

// AG-UI's StrandsAgent adapter also needs a sessionManagerProvider (called
// once per threadId) to persist conversation state, mirroring
// AGENT_TS_SESSION_MANAGER_CONSTRUCTOR_PATTERN's role for HTTP/A2A agents.
// Anchored on the literal `getAgent` import, which every ts#agent index.ts has.
const aguiIndexSessionManagerImportPattern = (esm: boolean) =>
  `\`import { getAgent } from '$mod';\` => raw\`import { getAgent } from '$mod';
import { getSessionManager } from './session${esm ? '.js' : ''}';\` where { $program <: not contains \`getSessionManager\` }`;
// Anchored on the exact 4-property shape AGUI_INDEX_CONSTRUCTOR_PATTERN
// produces, so this only fires once plugins have been wired in, and stops
// matching once config is added (naturally idempotent). Used both to gate
// (via matchGritQL, before creating session.ts) and to rewrite.
const AGUI_INDEX_SESSION_MANAGER_MATCH_PATTERN =
  '`new StrandsAgent({ agent, name: $name, description: $desc, plugins: $plugins })`';
const AGUI_INDEX_SESSION_MANAGER_CONSTRUCTOR_PATTERN = `${AGUI_INDEX_SESSION_MANAGER_MATCH_PATTERN} => \`new StrandsAgent({ agent, name: $name, description: $desc, plugins: $plugins, config: { sessionManagerProvider: getSessionManager } })\``;

// The AGUI_INDEX_* patterns above reference ModelErrorLoggingPlugin/
// ToolErrorLoggingPlugin, but those classes only exist in the current
// model-errors-strands.ts/tool-errors-strands.ts templates — an existing
// workspace's already-generated copies (vended with `KeepExisting`, so never
// overwritten by re-running the generator) still have only the plain
// logModelErrors/logToolErrors functions. Without these, the AG-UI index.ts
// patch above would reference undefined classes. Anchored on the
// `agent.addHook(AfterXCallEvent, ...)` call so this doesn't re-match its own
// output (the delegating one-liner it produces contains no such call).
const MODEL_ERRORS_IMPORT_PATTERN =
  "`import { AfterModelCallEvent, type LocalAgent } from '@strands-agents/sdk';` => `import { AfterModelCallEvent, type LocalAgent, type Plugin } from '@strands-agents/sdk';`";
const MODEL_ERRORS_CLASS_PATTERN =
  "`export const logModelErrors = (agent: LocalAgent): void => { agent.addHook(AfterModelCallEvent, $callback); };` => raw`export class ModelErrorLoggingPlugin implements Plugin {\n  readonly name = 'model-error-logging';\n\n  initAgent(agent: LocalAgent): void {\n    agent.addHook(AfterModelCallEvent, $callback);\n  }\n}\n\nexport const logModelErrors = (agent: LocalAgent): void =>\n  new ModelErrorLoggingPlugin().initAgent(agent);`";

const TOOL_ERRORS_IMPORT_PATTERN =
  "`import { AfterToolCallEvent, type LocalAgent, TextBlock } from '@strands-agents/sdk';` => `import { AfterToolCallEvent, type LocalAgent, type Plugin, TextBlock } from '@strands-agents/sdk';`";
const TOOL_ERRORS_CLASS_PATTERN =
  "`export const logToolErrors = (agent: LocalAgent): void => { agent.addHook(AfterToolCallEvent, $callback); };` => raw`export class ToolErrorLoggingPlugin implements Plugin {\n  readonly name = 'tool-error-logging';\n\n  initAgent(agent: LocalAgent): void {\n    agent.addHook(AfterToolCallEvent, $callback);\n  }\n}\n\nexport const logToolErrors = (agent: LocalAgent): void =>\n  new ToolErrorLoggingPlugin().initAgent(agent);`";

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];
  let anyChanges = false;

  const filePaths: string[] = [];
  visitNotIgnoredFiles(tree, '', (filePath) => filePaths.push(filePath));

  for (const filePath of filePaths) {
    if (filePath.endsWith('.d.ts')) {
      continue;
    }

    // session.ts (whether generator-vended or created by this
    // migration above) already targets the new { arn, session } shape via
    // `config.agentRuntimes?.[$name]?.session?.bucketName` — the generic
    // reshape branch below would otherwise mis-match that expression's
    // `config.agentRuntimes?.[$name]` prefix and corrupt it into
    // `?.arn?.session?.bucketName`.
    if (filePath.endsWith('/session.ts')) {
      continue;
    }

    if (filePath.endsWith('/agent.ts') && isAgUiAgentDir(tree, filePath)) {
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
        nextSteps.push(
          `${filePath}: moved the model/tool error logging hooks to StrandsAgent plugins (see the sibling index.ts).`,
        );
        anyChanges = true;
      }
      continue;
    }

    // HTTP/A2A agent.ts: wire sessionManager into the Agent constructor and
    // create the sibling session.ts if it doesn't exist yet. Existing
    // agents predate session.ts entirely, so (unlike the reshape
    // patterns above) there's no "old shape" to pattern-match for the file's
    // own existence — gate on the logModelErrors/logToolErrors import as the
    // signal this is a ts#agent-generated agent.ts. Matched via GritQL (not a
    // literal substring check) so this isn't fooled by prettier wrapping the
    // import onto multiple lines (e.g. a long npm scope name). The
    // constructor is only ever rewritten once the getSessionManager import is
    // confirmed present, so a failed session.ts creation can never
    // leave a dangling reference to an undefined function.
    if (
      filePath.endsWith('/agent.ts') &&
      (await matchGritQL(tree, filePath, AGENT_TS_LOG_IMPORT_CAPTURE_PATTERN))
    ) {
      const dir = filePath.split('/').slice(0, -1).join('/');
      const sessionPath = `${dir}/session.ts`;

      if (!tree.exists(sessionPath)) {
        const project = findOwningProject(tree, dir);
        const capturedImport = await captureGritQL(
          tree,
          filePath,
          AGENT_TS_LOG_IMPORT_CAPTURE_PATTERN,
        );
        const mod = capturedImport?.match(/from '([^']+)'/)?.[1];

        if (project && mod) {
          const dirName = dir.split('/').filter(Boolean).pop() ?? dir;
          tree.write(
            sessionPath,
            legacySessionManagerContent(
              mod,
              localSessionsDirFor(
                project.root,
                agentTmpNameFor(project.name, dirName),
              ),
            ),
          );
        } else {
          nextSteps.push(
            `${filePath}: could not determine the project root or agent-connection module — manually create a session.ts (see the ts#agent generator's template) and wire \`sessionManager: await getSessionManager()\` into the Agent constructor.`,
          );
          continue;
        }
      }

      // Leaves the existing import's specifier list untouched (rather than
      // requiring it to be exactly `{ logModelErrors, logToolErrors }`) and
      // just appends a new import statement after it, since a connection
      // generator may have merged its own client import into the same
      // statement via addDestructuredImport.
      const esm = isEsmWorkspace(tree);
      await applyGritQL(
        tree,
        filePath,
        `\`import { $names } from '$mod';\` => raw\`import { $names } from '$mod';
import { getSessionManager } from './session${esm ? '.js' : ''}';\` where { $names <: contains \`logModelErrors\`, $names <: contains \`logToolErrors\`, $program <: not contains \`getSessionManager\` }`,
      );

      // Only rewrite the constructor once the import is confirmed present —
      // either just added above, or already there from a prior partial run.
      if (!(tree.read(filePath, 'utf-8') ?? '').includes('getSessionManager')) {
        nextSteps.push(
          `${filePath}: found ${sessionPath} but couldn't confirm the getSessionManager import — wire \`sessionManager: await getSessionManager()\` into the Agent constructor manually.`,
        );
        continue;
      }

      const rewroteConstructor = await applyGritQL(
        tree,
        filePath,
        AGENT_TS_SESSION_MANAGER_CONSTRUCTOR_PATTERN,
      );
      if (rewroteConstructor) {
        nextSteps.push(
          `${filePath}: wired sessionManager into the Agent constructor (see ${sessionPath}).`,
        );
        anyChanges = true;
      }
      continue;
    }

    if (
      filePath.endsWith('/index.ts') &&
      (tree.read(filePath, 'utf-8') ?? '').includes('@ag-ui/aws-strands')
    ) {
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
        nextSteps.push(
          `${filePath}: wired ModelErrorLoggingPlugin/ToolErrorLoggingPlugin into the StrandsAgent constructor.`,
        );
        anyChanges = true;
      }

      // The StrandsAgent adapter also needs a sessionManagerProvider — create
      // the sibling session.ts if it doesn't exist yet, same as the
      // HTTP/A2A branch above, then wire it in once the plugins are present.
      // Gated on the exact shape the rewrite targets, checked up front via
      // matchGritQL, so a customised (non-standard) constructor is left
      // entirely alone rather than creating an unused session.ts.
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
        const capturedImport = await captureGritQL(
          tree,
          filePath,
          AGUI_INDEX_IMPORT_CAPTURE_PATTERN,
        );
        const mod = capturedImport?.match(/from '([^']+)'/)?.[1];

        if (project && mod) {
          const dirName = dir.split('/').filter(Boolean).pop() ?? dir;
          tree.write(
            sessionPath,
            legacySessionManagerContent(
              mod,
              localSessionsDirFor(
                project.root,
                agentTmpNameFor(project.name, dirName),
              ),
            ),
          );
        } else {
          nextSteps.push(
            `${filePath}: could not determine the project root or agent-connection module — manually create a session.ts (see the ts#agent generator's template) and wire \`config: { sessionManagerProvider: getSessionManager }\` into the StrandsAgent constructor.`,
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
        nextSteps.push(
          `${filePath}: wired sessionManagerProvider into the StrandsAgent constructor (see ${sessionPath}).`,
        );
        anyChanges = true;
      }
      continue;
    }

    if (filePath.endsWith('/model-errors-strands.ts')) {
      const rewroteImport = await applyGritQL(
        tree,
        filePath,
        MODEL_ERRORS_IMPORT_PATTERN,
      );
      const rewroteClass = await applyGritQL(
        tree,
        filePath,
        MODEL_ERRORS_CLASS_PATTERN,
      );
      if (rewroteImport || rewroteClass) {
        nextSteps.push(`${filePath}: added the ModelErrorLoggingPlugin class.`);
        anyChanges = true;
      }
      continue;
    }

    if (filePath.endsWith('/tool-errors-strands.ts')) {
      const rewroteImport = await applyGritQL(
        tree,
        filePath,
        TOOL_ERRORS_IMPORT_PATTERN,
      );
      const rewroteClass = await applyGritQL(
        tree,
        filePath,
        TOOL_ERRORS_CLASS_PATTERN,
      );
      if (rewroteImport || rewroteClass) {
        nextSteps.push(`${filePath}: added the ToolErrorLoggingPlugin class.`);
        anyChanges = true;
      }
      continue;
    }

    if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      const contents = tree.read(filePath, 'utf-8') ?? '';
      if (!contents.includes('agentRuntimes')) {
        continue;
      }
      // Each rewrite is attempted independently (not short-circuited) since
      // a single file may match more than one shape.
      const rewroteAgentcoreRcSet = await applyGritQL(
        tree,
        filePath,
        cdkRcSetPattern('agentcore'),
      );
      const rewroteConnectionRcSet = await applyGritQL(
        tree,
        filePath,
        cdkRcSetPattern('connection'),
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
      const rewroteDuckTyping = await applyGritQL(
        tree,
        filePath,
        REACT_DUCK_TYPING_PATTERN,
      );

      if (
        rewroteAgentcoreRcSet ||
        rewroteConnectionRcSet ||
        rewroteInterface ||
        rewroteClientArn ||
        rewroteDuckTyping
      ) {
        nextSteps.push(
          `${filePath}: reshaped agentRuntimes entries to { arn, session }.`,
        );
        anyChanges = true;
      }
    } else if (filePath.endsWith('.tf')) {
      const contents = tree.read(filePath, 'utf-8') ?? '';
      if (!contents.includes('"agentRuntimes"')) {
        continue;
      }
      const rewrote = await applyGritQL(tree, filePath, TF_VALUE_PATTERN);
      if (rewrote) {
        nextSteps.push(
          `${filePath}: reshaped agentRuntimes entries to { arn, session }.`,
        );
        anyChanges = true;
      }
    } else if (filePath.endsWith('.py')) {
      const contents = tree.read(filePath, 'utf-8') ?? '';
      if (!contents.includes('agentRuntimes')) {
        continue;
      }
      const rewrote = await applyGritQL(tree, filePath, PY_CLIENT_ARN_PATTERN);
      if (rewrote) {
        nextSteps.push(
          `${filePath}: reshaped agentRuntimes entries to { arn, session }.`,
        );
        anyChanges = true;
      }
    }
  }

  if (anyChanges) {
    nextSteps.push(
      'If you have custom code reading agentRuntimes entries as plain ARN strings ' +
        '(e.g. custom Lambda handlers or agent code), update it to read the ARN from `.arn` ' +
        'on the new `{ arn, session }` shape.',
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
