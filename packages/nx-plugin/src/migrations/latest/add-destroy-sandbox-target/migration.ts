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
  updateProjectConfiguration,
} from '@nx/devkit';
import { readFileSync } from 'fs';
import { join } from 'path';
import { INFRA_APP_GENERATOR_INFO } from '../../../infra/app/generator.js';
import { captureGritQLVariable } from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { normalizeTargetKeyOrder } from '../../../utils/nx.js';
import { sortObjectKeys } from '../../../utils/object.js';
import {
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
} from '../../../utils/shared-constructs-constants.js';

/**
 * CDK infrastructure projects gained a `destroy-sandbox` target, mirroring
 * `deploy-sandbox`: it tears down the sandbox stage without the user having to
 * spell out its stage pattern (`nx destroy-sandbox infra` rather than
 * `nx destroy infra "my-app-infra-sandbox/*"`).
 *
 * The stage id is read from `main.ts` rather than recomputed from the project
 * name, so a project whose sandbox stage has been renamed gets a target that
 * destroys the stage it actually declares.
 *
 * The destroy targets also move from `--require-approval=never` to `--force`.
 * `cdk destroy` has no `--require-approval` option — it ignores the flag and
 * then blocks on a confirmation prompt, which fails outright under nx, where no
 * TTY is attached. The same fix lands in the vended `buildCdkCommand`, which
 * builds the command for `stageConfig` workspaces.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 */

const TARGET = 'destroy-sandbox';

/** The destroy targets whose non-interactive flag is corrected. */
const DESTROY_TARGETS = ['destroy', 'destroy-ci'] as const;

/** `cdk destroy` silently ignores this, then prompts for confirmation. */
const IGNORED_APPROVAL_FLAG = /\s*--require-approval(=\S*)?/;

/**
 * Matches `new ApplicationStage(app, '<id>-sandbox', { ... })`, binding the
 * quoted stage id. The regex spans the quotes because it is matched against the
 * whole string literal node; both quote styles are accepted since the user's
 * formatter may have rewritten them.
 *
 * `main.ts` can declare several stages (beta, prod), so the pattern selects the
 * sandbox one rather than whichever comes first.
 */
const SANDBOX_STAGE_PATTERN =
  '`new ApplicationStage($app, $id, $props)` where { $id <: r"[\'\\"].*-sandbox[\'\\"]" }';

/** The id of the sandbox stage a project's `main.ts` instantiates. */
const sandboxStageId = async (
  tree: Tree,
  projectRoot: string,
): Promise<string | undefined> => {
  const captured = await captureGritQLVariable(
    tree,
    joinPathFragments(projectRoot, 'src', 'main.ts'),
    SANDBOX_STAGE_PATTERN,
    'id',
  );
  // The binding keeps the quotes from the source.
  return captured?.slice(1, -1);
};

/**
 * Swap `--require-approval` for `--force` in a `cdk destroy` command. Returns
 * undefined when the command isn't the shape the generator produced, or already
 * runs non-interactively.
 */
const withForceFlag = (command: unknown): string | undefined => {
  if (typeof command !== 'string' || !command.includes('cdk destroy')) {
    return undefined;
  }
  if (!IGNORED_APPROVAL_FLAG.test(command)) return undefined;
  const stripped = command.replace(IGNORED_APPROVAL_FLAG, '');
  return /(^|\s)(--force|-f)(\s|$)/.test(stripped)
    ? stripped
    : stripped.replace('cdk destroy', 'cdk destroy --force');
};

/** Corrects the non-interactive flag on the project's destroy targets. */
const migrateDestroyFlags = (project: ProjectConfiguration): boolean => {
  let changed = false;
  for (const name of DESTROY_TARGETS) {
    const target = project.targets?.[name];
    const command = withForceFlag(target?.options?.command);
    if (command) {
      target.options = { ...target.options, command };
      changed = true;
    }
  }
  return changed;
};

/** Path the shared scripts package vends the CDK command builder at. */
const CDK_COMMAND_PATH = joinPathFragments(
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
  'src/infra/stage-credentials/cdk-command.ts',
);

/** The builder as it stands today. The template carries no EJS variables. */
const CDK_COMMAND_TEMPLATE = readFileSync(
  join(
    import.meta.dirname,
    '../../../utils/files/common/scripts/src/infra/stage-credentials/cdk-command.ts.template',
  ),
  'utf-8',
);

/**
 * Re-vends the CDK command builder, which picks the non-interactive flag per
 * action rather than always passing `--require-approval`. Only the shape the
 * generator produced is replaced: a customised copy is the user's, so it is
 * reported instead.
 */
const migrateCdkCommandBuilder = (tree: Tree, nextSteps: string[]): void => {
  if (!tree.exists(CDK_COMMAND_PATH)) return;

  const current = tree.read(CDK_COMMAND_PATH)!.toString();
  // Already migrated, so a re-run is a no-op.
  if (current.includes("action === 'destroy'")) return;

  if (!current.includes('hasRequireApproval')) {
    nextSteps.push(
      `${CDK_COMMAND_PATH}: has diverged from the generated shape — left untouched. Have it pass \`--force\` rather than \`--require-approval\` for the \`destroy\` action, otherwise 'destroy' blocks on a confirmation prompt when run without a TTY.`,
    );
    return;
  }

  tree.write(CDK_COMMAND_PATH, CDK_COMMAND_TEMPLATE);
};

/** Adds the `destroy-sandbox` target, mirroring the project's `destroy`. */
const addSandboxTarget = async (
  tree: Tree,
  projectName: string,
  project: ProjectConfiguration,
  nextSteps: string[],
): Promise<boolean> => {
  // The new target mirrors `destroy`, so it inherits whatever that resolved to
  // when the project was generated: the `tsx` credential-resolving script
  // under `stageConfig`, plain `cdk destroy` otherwise.
  const destroy = project.targets.destroy;
  const command = destroy?.options?.command;
  const mainPath = joinPathFragments(project.root, 'src/main.ts');
  const stageId = await sandboxStageId(tree, project.root);

  if (typeof command !== 'string') {
    nextSteps.push(
      `Add a '${TARGET}' target to ${projectName} by hand if necessary — its 'destroy' target no longer matches the shape the generator produced.`,
    );
    return false;
  }
  if (!stageId) {
    nextSteps.push(
      `Add a '${TARGET}' target to ${projectName} by hand if necessary — no sandbox stage was found in ${mainPath}.`,
    );
    return false;
  }

  project.targets[TARGET] = normalizeTargetKeyOrder({
    executor: destroy.executor,
    ...(destroy.dependsOn ? { dependsOn: [...destroy.dependsOn] } : {}),
    // Quoted so the shell does not glob the `*`.
    options: { ...destroy.options, command: `${command} "${stageId}/*"` },
  });
  return true;
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    const generator = (project.metadata as { generator?: string } | undefined)
      ?.generator;
    // Not a CDK infrastructure project.
    if (generator !== INFRA_APP_GENERATOR_INFO.id) continue;

    // Corrected first so the new target inherits the fixed command.
    let changed = migrateDestroyFlags(project);

    if (!project.targets?.[TARGET]) {
      changed =
        (await addSandboxTarget(tree, projectName, project, nextSteps)) ||
        changed;
    }

    if (changed) {
      updateProjectConfiguration(tree, projectName, {
        ...project,
        targets: sortObjectKeys(project.targets),
      });
    }
  }

  migrateCdkCommandBuilder(tree, nextSteps);

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
