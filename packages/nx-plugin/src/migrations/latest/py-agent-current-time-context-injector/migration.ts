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
import { parsePipRequirementsLine } from 'pip-requirements-js';
import { PY_AGENT_GENERATOR_INFO } from '../../../py/agent/generator.js';
import {
  addPythonDestructuredImport,
  applyGritQL,
  GRIT_INSERT_PLACEHOLDER,
  insertViaGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { normalizeDistributionName } from '../../../utils/names.js';
import type { ComponentMetadata } from '../../../utils/nx.js';
import type { UVPyprojectToml } from '../../../utils/nxlv-python.js';
import { tryReadToml } from '../../../utils/toml.js';

/**
 * Tell py#agent Strands agents the current time with a `CurrentTimePlugin`
 * instead of the `current_time` tool.
 *
 * strands-agents-tools 0.9.0 removed every tool: importing `current_time`
 * raises ImportError. In its place the generator vends a small plugin that
 * adds the current UTC time to the system prompt before each model call, so
 * the model knows the time without a tool and without the time ever landing
 * in the user's message text.
 *
 * An `agent.py` is rewritten only when it still has the shape the generator
 * wrote: the single `from strands_tools import current_time` line,
 * `current_time` in the `Agent(...)` tools list and nowhere else, the
 * `AGENT_HOOKS` constant passed as `hooks=AGENT_HOOKS`, and no plugins or
 * names the rewrite would add. An AG-UI agent's `main.py` must also still pass
 * `hooks=AGENT_HOOKS` to `StrandsAgent(...)`, because AG-UI copies neither
 * hooks nor plugins from the template Agent and needs `plugins=` there too.
 *
 * Every other Python file in a py#agent project that uses
 * `strands_tools`'s `current_time` is left unchanged and listed in `nextSteps`.
 *
 * The generator no longer adds strands-agents-tools, but this migration leaves
 * the dependency in place: a py#agent project whose `[project].dependencies`
 * lists it gets a `nextSteps` note to keep it below 0.9 or remove it.
 */

const OLD_IMPORT = 'from strands_tools import current_time';

/** The `CurrentTimePlugin` class the generator vends, shared by agent.py and
 * (for AG-UI) main.py. */
const CURRENT_TIME_PLUGIN_CLASS = `class CurrentTimePlugin(Plugin):
    """Gives the model the current UTC time by adding it to the system prompt
    before each model call, without changing the user's message text."""

    name = "current-time"

    def init_agent(self, agent: Agent) -> None:
        async def add_current_time(context: InvokeModelContext) -> InvokeModelContext:
            time_block: SystemContentBlock = {
                "text": f"<current_time>{datetime.now(UTC).isoformat()}</current_time>"
            }
            system_prompt = context.system_prompt
            if isinstance(system_prompt, str):
                blocks: list[SystemContentBlock] = [{"text": system_prompt}, time_block]
            elif system_prompt is None:
                blocks = [time_block]
            else:
                blocks = [*system_prompt, time_block]
            return context.replace(system_prompt=blocks)

        agent.add_middleware(InvokeModelStage.Input, add_current_time)`;

/** The plugin and constant inserted after `AGENT_HOOKS` in a non-AG-UI agent.py. */
const AGENT_PLUGINS_CONSTANT = `${CURRENT_TIME_PLUGIN_CLASS}


# Gives the model the current time with each model call
AGENT_PLUGINS: list[Plugin] = [CurrentTimePlugin()]`;

/**
 * The plugin and constant inserted into an AG-UI main.py. AG-UI reads plugins
 * off the adapter rather than the template Agent, and agent.py is the file
 * users rewrite, so the plugin lives here instead of in agent.py.
 */
const MAIN_PLUGINS_CONSTANT = `${CURRENT_TIME_PLUGIN_CLASS}


# Gives the model the current time with each model call. Defined here, not in
# agent.py, because AG-UI reads plugins off this adapter rather than the
# template Agent, and agent.py is the file users rewrite for their own agent.
AGENT_PLUGINS: list[Plugin] = [CurrentTimePlugin()]`;

/** The logging line an AG-UI main.py carries; the plugin is inserted after it. */
const MAIN_LOGGING_LINE = 'logging.basicConfig(level=logging.INFO)';

/** The comment the generator vends above `plugins=` in an AG-UI main.py. */
const AGUI_PLUGINS_COMMENT =
  '# AG-UI does not copy plugins from the template Agent either.';

/** Names the rewrite adds to agent.py, which must not already be in use. */
const ADDED_NAMES = [
  'AGENT_PLUGINS',
  'CurrentTimePlugin',
  'InvokeModelContext',
  'InvokeModelStage',
  'Plugin',
  'SystemContentBlock',
  'UTC',
  'datetime',
];

const py = (pattern: string) => `language python\n${pattern}`;

const TOOLS_HAS_CURRENT_TIME = py(
  '`tools=[$items]` as $kwarg where { $kwarg <: within `Agent($_)`, $items <: some `current_time` }',
);
const DROP_CURRENT_TIME_TOOL = py(
  '`current_time` as $tool where { $tool <: within `tools=[$_]`, $tool <: within `Agent($_)`, $tool => . }',
);
const AGENT_HOOKS_KWARG = py(
  '`hooks=AGENT_HOOKS` as $kwarg where { $kwarg <: within `Agent($_)` }',
);
const ADD_AGENT_PLUGINS_KWARG = py(
  '`hooks=AGENT_HOOKS` as $kwarg where { $kwarg <: within `Agent($_)`, $kwarg => `hooks=AGENT_HOOKS, plugins=AGENT_PLUGINS` }',
);
const INSERT_AGENT_PLUGINS_CONSTANT = py(
  `\`AGENT_HOOKS: $type = $value\` => raw\`AGENT_HOOKS: $type = $value\n${GRIT_INSERT_PLACEHOLDER}\``,
);
const AGUI_HOOKS_KWARG = py(
  '`StrandsAgent($args)` where { $args <: contains `hooks=AGENT_HOOKS`, $args <: not contains `plugins=$_` }',
);
const AGUI_ADD_PLUGINS_KWARG = py(
  `\`hooks=AGENT_HOOKS\` as $kwarg where { $kwarg <: within \`StrandsAgent($_)\`, $kwarg => raw\`hooks=AGENT_HOOKS,\n${AGUI_PLUGINS_COMMENT}\nplugins=AGENT_PLUGINS\` }`,
);

const countWord = (content: string, word: string): number =>
  content.match(new RegExp(`\\b${word}\\b`, 'g'))?.length ?? 0;

/** True when a Python file uses `current_time` from strands-agents-tools. */
const usesStrandsCurrentTime = (content: string): boolean =>
  content.includes('strands_tools') && countWord(content, 'current_time') > 0;

const divergedNextStep = (filePath: string): string =>
  `${filePath}: it uses current_time from strands-agents-tools in a shape this migration does not recognise, so it was left unchanged. strands-agents-tools 0.9.0 removed current_time (importing it raises ImportError). Remove the tool and give the agent the time with a context plugin instead, as the py#agent generator does: https://strandsagents.com/docs/user-guide/migrate/strands-agents-tools/`;

const STRANDS_TOOLS = 'strands-agents-tools';

/** True when a requirement names strands-agents-tools, in any PEP 503 spelling. */
const isStrandsToolsRequirement = (requirement: unknown): boolean => {
  if (typeof requirement !== 'string') return false;
  try {
    const parsed = parsePipRequirementsLine(requirement);
    return (
      (parsed?.type === 'ProjectName' || parsed?.type === 'ProjectURL') &&
      normalizeDistributionName(parsed.name) === STRANDS_TOOLS
    );
  } catch {
    return false;
  }
};

/** True when the pyproject.toml's `[project].dependencies` lists strands-agents-tools. */
const listsStrandsTools = (tree: Tree, pyprojectPath: string): boolean => {
  const dependencies = (
    tryReadToml(tree, pyprojectPath) as UVPyprojectToml | undefined
  )?.project?.dependencies;
  return (
    Array.isArray(dependencies) && dependencies.some(isStrandsToolsRequirement)
  );
};

const strandsToolsNextStep = (pyprojectPath: string): string =>
  `${pyprojectPath}: it lists strands-agents-tools, which the py#agent generator no longer adds. strands-agents-tools 0.9.0 is a tombstone release (importing any of its tools raises ImportError); keep it pinned below 0.9 or remove it if unused.`;

/** True when agent.py, holding `content`, still has exactly the shape the generator wrote. */
const hasVendedAgentShape = async (
  tree: Tree,
  agentPath: string,
  content: string,
): Promise<boolean> => {
  const importLines = content
    .split('\n')
    .filter((line) => line.includes('strands_tools'));
  return (
    importLines.length === 1 &&
    importLines[0] === OLD_IMPORT &&
    // The import and the tools list entry.
    countWord(content, 'current_time') === 2 &&
    countWord(content, 'AGENT_HOOKS') === 2 &&
    !content.includes('plugins=') &&
    ADDED_NAMES.every((name) => countWord(content, name) === 0) &&
    (await matchGritQL(tree, agentPath, TOOLS_HAS_CURRENT_TIME)) &&
    (await matchGritQL(tree, agentPath, AGENT_HOOKS_KWARG))
  );
};

/** The strands imports the CurrentTimePlugin needs, added to a file. */
const addPluginImports = async (
  tree: Tree,
  filePath: string,
): Promise<void> => {
  await addPythonDestructuredImport(
    tree,
    filePath,
    ['UTC', 'datetime'],
    'datetime',
  );
  await addPythonDestructuredImport(
    tree,
    filePath,
    ['InvokeModelContext', 'InvokeModelStage'],
    'strands.middleware',
  );
  await addPythonDestructuredImport(
    tree,
    filePath,
    ['Plugin'],
    'strands.plugins',
  );
  await addPythonDestructuredImport(
    tree,
    filePath,
    ['SystemContentBlock'],
    'strands.types.content',
  );
};

/** Drop the current_time tool entry and its import from agent.py. */
const dropCurrentTime = async (
  tree: Tree,
  agentPath: string,
): Promise<void> => {
  await applyGritQL(tree, agentPath, DROP_CURRENT_TIME_TOOL);
  tree.write(
    agentPath,
    (tree.read(agentPath, 'utf-8') ?? '').replace(`${OLD_IMPORT}\n`, ''),
  );
};

/** Add the CurrentTimePlugin, AGENT_PLUGINS and its imports to agent.py. */
const addPluginToAgent = async (
  tree: Tree,
  agentPath: string,
): Promise<void> => {
  await insertViaGritQL(
    tree,
    agentPath,
    INSERT_AGENT_PLUGINS_CONSTANT,
    AGENT_PLUGINS_CONSTANT,
  );
  await applyGritQL(tree, agentPath, ADD_AGENT_PLUGINS_KWARG);
  await addPluginImports(tree, agentPath);
};

/**
 * Add the CurrentTimePlugin, AGENT_PLUGINS, its imports and the `plugins=`
 * kwarg to an AG-UI main.py. The plugin lives here, not in agent.py, because
 * AG-UI reads plugins off the adapter rather than the template Agent.
 */
const addPluginToMain = async (tree: Tree, mainPath: string): Promise<void> => {
  tree.write(
    mainPath,
    (tree.read(mainPath, 'utf-8') ?? '').replace(
      `${MAIN_LOGGING_LINE}\n`,
      `${MAIN_LOGGING_LINE}\n\n\n${MAIN_PLUGINS_CONSTANT}\n`,
    ),
  );
  await applyGritQL(tree, mainPath, AGUI_ADD_PLUGINS_KWARG);
  await addPythonDestructuredImport(tree, mainPath, ['Agent'], 'strands');
  await addPluginImports(tree, mainPath);
};

/**
 * Migrate one Strands agent, returning the files it reported or rewrote so the
 * workspace scan does not report them again.
 */
const migrateAgent = async (
  tree: Tree,
  agentDir: string,
  component: ComponentMetadata,
  nextSteps: string[],
): Promise<string[]> => {
  // LangChain agents never used strands-agents-tools.
  if (component.framework === 'langchain') return [];

  const agentPath = joinPathFragments(agentDir, 'agent.py');
  const mainPath = joinPathFragments(agentDir, 'main.py');
  const agentContent = tree.read(agentPath, 'utf-8') ?? '';
  if (!usesStrandsCurrentTime(agentContent)) return [];

  const isAgUi = component.protocol === 'ag-ui';
  if (
    !(await hasVendedAgentShape(tree, agentPath, agentContent)) ||
    (isAgUi && !(await matchGritQL(tree, mainPath, AGUI_HOOKS_KWARG)))
  ) {
    nextSteps.push(divergedNextStep(agentPath));
    return [agentPath];
  }

  await dropCurrentTime(tree, agentPath);
  // AG-UI reads plugins off the adapter, not the template Agent, and agent.py
  // is the file users rewrite, so the plugin goes in main.py there.
  if (isAgUi) {
    await addPluginToMain(tree, mainPath);
  } else {
    await addPluginToAgent(tree, agentPath);
  }
  return [agentPath];
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const project of getProjects(tree).values()) {
    const components = (
      (project.metadata as { components?: ComponentMetadata[] })?.components ??
      []
    ).filter((component) => component.generator === PY_AGENT_GENERATOR_INFO.id);
    if (components.length === 0) continue;

    const handled = new Set<string>();
    for (const component of components) {
      if (!component.path) continue;

      // Legacy component paths point at agent.py rather than its directory.
      const componentDir = component.path.endsWith('/agent.py')
        ? component.path.slice(0, -'/agent.py'.length)
        : component.path;

      const files = await migrateAgent(
        tree,
        joinPathFragments(project.root, componentDir),
        component,
        nextSteps,
      );
      for (const file of files) handled.add(file);
    }

    // Report any other file in the project that still uses current_time.
    visitNotIgnoredFiles(tree, project.root, (filePath) => {
      if (
        filePath.endsWith('.py') &&
        !handled.has(filePath) &&
        usesStrandsCurrentTime(tree.read(filePath, 'utf-8') ?? '')
      ) {
        nextSteps.push(divergedNextStep(filePath));
      }
    });

    // The dependency stays; only point out that 0.9.0 must not be installed.
    const pyprojectPath = joinPathFragments(project.root, 'pyproject.toml');
    if (listsStrandsTools(tree, pyprojectPath)) {
      nextSteps.push(strandsToolsNextStep(pyprojectPath));
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
