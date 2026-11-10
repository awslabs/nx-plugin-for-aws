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
 * Tell py#agent Strands agents the current time with a `ContextInjector`
 * plugin instead of the `current_time` tool.
 *
 * strands-agents-tools 0.9.0 removed every tool: importing `current_time`
 * raises ImportError. Its migration guide replaces `current_time` with the
 * SDK's `ContextInjector` plugin, which adds the time to the model input
 * before each user message so the model does not need to call a tool.
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

/** The constant inserted after `AGENT_HOOKS`, as the generator vends it. */
const AGENT_PLUGINS_CONSTANT = `# Gives the model the current time with each user message
AGENT_PLUGINS: list[Plugin] = [
    ContextInjector(lambda _: f"<current_time>{datetime.now(UTC).isoformat()}</current_time>"),
]`;

/** The comment the generator vends above `plugins=` in an AG-UI main.py. */
const AGUI_PLUGINS_COMMENT =
  '# AG-UI does not copy plugins from the template Agent either.';

/** Names the rewrite adds to agent.py, which must not already be in use. */
const ADDED_NAMES = [
  'AGENT_PLUGINS',
  'ContextInjector',
  'Plugin',
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
  `${filePath}: it uses current_time from strands-agents-tools in a shape this migration does not recognise, so it was left unchanged. strands-agents-tools 0.9.0 removed current_time (importing it raises ImportError). Remove the tool and give the agent the time with the ContextInjector plugin instead, as the py#agent generator does: https://strandsagents.com/docs/user-guide/migrate/strands-agents-tools/`;

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

/** True when agent.py still has exactly the shape the generator wrote. */
const hasVendedAgentShape = async (
  tree: Tree,
  agentPath: string,
): Promise<boolean> => {
  const content = tree.read(agentPath, 'utf-8') ?? '';
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

/** Rewrite agent.py from the current_time tool to the ContextInjector plugin. */
const rewriteAgent = async (tree: Tree, agentPath: string): Promise<void> => {
  await applyGritQL(tree, agentPath, DROP_CURRENT_TIME_TOOL);
  tree.write(
    agentPath,
    (tree.read(agentPath, 'utf-8') ?? '').replace(`${OLD_IMPORT}\n`, ''),
  );
  await insertViaGritQL(
    tree,
    agentPath,
    INSERT_AGENT_PLUGINS_CONSTANT,
    AGENT_PLUGINS_CONSTANT,
  );
  await applyGritQL(tree, agentPath, ADD_AGENT_PLUGINS_KWARG);
  await addPythonDestructuredImport(
    tree,
    agentPath,
    ['UTC', 'datetime'],
    'datetime',
  );
  await addPythonDestructuredImport(
    tree,
    agentPath,
    ['Plugin'],
    'strands.plugins',
  );
  await addPythonDestructuredImport(
    tree,
    agentPath,
    ['ContextInjector'],
    'strands.vended_plugins.context_injector',
  );
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
  if (!usesStrandsCurrentTime(tree.read(agentPath, 'utf-8') ?? '')) return [];

  const isAgUi = component.protocol === 'ag-ui';
  if (
    !(await hasVendedAgentShape(tree, agentPath)) ||
    (isAgUi && !(await matchGritQL(tree, mainPath, AGUI_HOOKS_KWARG)))
  ) {
    nextSteps.push(divergedNextStep(agentPath));
    return [agentPath];
  }

  await rewriteAgent(tree, agentPath);
  if (isAgUi) {
    await applyGritQL(tree, mainPath, AGUI_ADD_PLUGINS_KWARG);
    await addPythonDestructuredImport(
      tree,
      mainPath,
      ['AGENT_PLUGINS'],
      '.agent',
    );
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
