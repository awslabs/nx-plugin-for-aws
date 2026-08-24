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
  GRIT_INSERT_PLACEHOLDER,
  insertViaGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import type { ComponentMetadata } from '../../../utils/nx.js';

/**
 * Forward a Strands py#agent's hooks to the AG-UI adapter.
 *
 * `StrandsAgent` builds a fresh `Agent` per `thread_id` by copying the template
 * Agent's kwargs, but deliberately skips `hooks` - Strands keeps only the built
 * `HookRegistry`, so the providers can't be read back off it. An AG-UI agent's
 * `log_model_errors` / `log_tool_errors` therefore never fired for served
 * requests, and model/tool failures were reported as successful runs.
 *
 * The fix hoists the hooks list out of the `Agent(...)` call into an
 * `AGENT_HOOKS` module constant in `agent.py` - whatever the user has put in it,
 * so custom hooks come along - and passes that to `StrandsAgent(...)` in
 * `main.py` as well. `agent.py` is hoisted for every protocol so the constant
 * matches what the generator vends today; only AG-UI needs the `main.py` half.
 */

// `Agent`'s `hooks` list is invariant, so the hoisted constant has to declare
// the parameter's own type - an inline literal was inferred from it instead.
const HOOKS_TYPE = 'list[HookProvider | HookCallback]';
const HOOKS_MODULE = 'strands.hooks';

// Anchored on the `get_agent` context manager - the one shape shared by every
// generated protocol and connection combination - so the constant lands
// directly above its only use, where the generator vends it.
const HOIST_HOOKS_PATTERN = `language python
\`@contextmanager
def get_agent($params):
    $body\` => raw\`AGENT_HOOKS: ${HOOKS_TYPE} = ${GRIT_INSERT_PLACEHOLDER}


@contextmanager
def get_agent($params):
    $body\` where { $program <: not contains \`AGENT_HOOKS\` }`;

// Scoped to the Agent constructor so a hooks list the user passes elsewhere in
// agent.py is left alone.
const HOOKS_LIST_CAPTURE_PATTERN =
  'language python\n`hooks=[$hooks]` where { $hooks <: within `Agent($_)` }';
const HOOKS_LIST_REWRITE_PATTERN =
  'language python\n`hooks=[$_]` as $kwarg where { $kwarg <: within `Agent($_)`, $kwarg => `hooks=AGENT_HOOKS` }';

const AGUI_CONSTRUCTOR_MATCH_PATTERN =
  'language python\n`StrandsAgent($args)` where { $args <: contains `agent=$_` }';
const AGUI_HOOKS_WIRED_PATTERN =
  'language python\n`StrandsAgent($args)` where { $args <: contains `agent=$_`, $args <: contains `hooks=$_` }';
// Appends after the last argument rather than re-emitting the argument list,
// both to land `hooks=` where the template puts it and to leave the other
// arguments' formatting and comments untouched.
const AGUI_HOOKS_APPEND_PATTERN =
  'language python\n`StrandsAgent($args)` where { $args <: contains `agent=$_`, $args <: not contains `hooks=$_`, $args <: [$..., $last], $last += `, hooks=AGENT_HOOKS` }';

const findAgentComponents = (
  components: ComponentMetadata[] | undefined,
): ComponentMetadata[] =>
  (components ?? []).filter(
    (component) => component.generator === PY_AGENT_GENERATOR_INFO.id,
  );

/**
 * Hoists `agent.py`'s `hooks=[...]` list into an `AGENT_HOOKS` module constant,
 * returning whether the file ends up exporting one.
 */
const hoistAgentHooks = async (
  tree: Tree,
  agentPath: string,
): Promise<boolean> => {
  if ((tree.read(agentPath, 'utf-8') ?? '').includes('AGENT_HOOKS')) {
    return true;
  }

  // Nothing to hoist unless the Agent is constructed with an inline hooks list.
  const hooks = await captureGritQLVariable(
    tree,
    agentPath,
    HOOKS_LIST_CAPTURE_PATTERN,
    'hooks',
  );
  if (!hooks) return false;

  if (
    !(await insertViaGritQL(tree, agentPath, HOIST_HOOKS_PATTERN, `[${hooks}]`))
  ) {
    return false;
  }
  await applyGritQL(tree, agentPath, HOOKS_LIST_REWRITE_PATTERN);
  await addPythonDestructuredImport(
    tree,
    agentPath,
    ['HookCallback', 'HookProvider'],
    HOOKS_MODULE,
  );
  return true;
};

const migrateAgent = async (
  tree: Tree,
  agentDir: string,
  component: ComponentMetadata,
  nextSteps: string[],
): Promise<void> => {
  // LangChain agents pass no hooks - their AG-UI adapter is handed the graph
  // itself rather than rebuilding one, so nothing is dropped.
  if (component.framework === 'langchain') return;

  const agentPath = joinPathFragments(agentDir, 'agent.py');
  const mainPath = joinPathFragments(agentDir, 'main.py');
  const isAgUi = component.protocol === 'ag-ui';

  if (!tree.exists(agentPath)) return;

  if (!(await hoistAgentHooks(tree, agentPath))) {
    if (isAgUi) {
      nextSteps.push(
        `${agentPath}: the hooks passed to \`Agent(...)\` have diverged from the generated shape - left untouched. Hoist them into an \`AGENT_HOOKS\` module constant and pass it to \`StrandsAgent(...)\` in ${mainPath} too, or AG-UI will not register them (see the py#agent generator's template).`,
      );
    }
    return;
  }

  // Only AG-UI rebuilds the Agent, so only its main.py needs the hooks.
  if (!isAgUi || !tree.exists(mainPath)) return;

  // Already passing hooks, whether from a previous run or the user's own wiring.
  if (await matchGritQL(tree, mainPath, AGUI_HOOKS_WIRED_PATTERN)) return;

  if (!(await matchGritQL(tree, mainPath, AGUI_CONSTRUCTOR_MATCH_PATTERN))) {
    nextSteps.push(
      `${mainPath}: the \`StrandsAgent(...)\` constructor has diverged from the generated shape - left untouched. Pass \`hooks=AGENT_HOOKS\` to it, importing \`AGENT_HOOKS\` from \`.agent\`, or AG-UI will not register the agent's hooks (see the py#agent generator's template).`,
    );
    return;
  }

  await applyGritQL(tree, mainPath, AGUI_HOOKS_APPEND_PATTERN);
  await addPythonDestructuredImport(tree, mainPath, ['AGENT_HOOKS'], '.agent');
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

      // Legacy component paths point at agent.py rather than its directory.
      const componentDir = component.path.endsWith('/agent.py')
        ? component.path.slice(0, -'/agent.py'.length)
        : component.path;

      await migrateAgent(
        tree,
        joinPathFragments(project.root, componentDir),
        component,
        nextSteps,
      );
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
