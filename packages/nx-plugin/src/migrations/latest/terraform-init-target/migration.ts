/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type TargetConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { relative } from 'path';
import { TERRAFORM_PROJECT_GENERATOR_INFO } from '../../../terraform/project/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { sortObjectKeys } from '../../../utils/object.js';

/**
 * Give the shared Terraform provider plugin cache a single writer.
 *
 * `init`, `test` and `validate` each ran their own `terraform init` against one
 * per-project cache, and Nx schedules them concurrently — `plan` depends on both
 * `init` and `validate`. Two `terraform init` runs filling the cache at once each
 * compute a different hash for the same provider, because the hash covers a
 * directory the other is still writing, and terraform then rejects the mismatch
 * against the lock file: "the cached package ... does not match any of the
 * checksums recorded in the dependency lock file".
 *
 * The new `terraform-init` target runs that init once, and `test`, `validate` and
 * `init` depend on it — `test` and `validate` now run against the `TF_DATA_DIR`
 * it prepared rather than initialising their own.
 */

const TERRAFORM_INIT = 'terraform-init';

/** `terraform init` as the pre-fix `test` and `validate` targets ran it. */
const BACKENDLESS_INIT = 'terraform init -backend=false';

const divergedStep = (projectName: string, targetName: string) =>
  `${projectName}: its '${targetName}' target no longer matches the shape the generator produced - left untouched. Point it at the \`TF_DATA_DIR\` of the new \`${TERRAFORM_INIT}\` target and add \`"dependsOn": ["${TERRAFORM_INIT}"]\`, so its \`terraform init\` no longer races the other targets over the provider cache.`;

/** Path from a target running in `{projectRoot}/src` back to the workspace root. */
const rootRelativePath = (projectRoot: string) =>
  (relative(joinPathFragments(projectRoot, 'src'), '.') || '.').replace(
    /\\/g,
    '/',
  );

const pluginCacheDirFor = (toRoot: string) =>
  joinPathFragments(toRoot, '.terraform', 'plugin-cache', '{projectRoot}');

const dataDirFor = (toRoot: string, name: string) =>
  joinPathFragments(toRoot, 'dist', '{projectRoot}', name);

/**
 * The target as the generator vends it: `-backend=false` needs no credentials,
 * so this runs on a fresh workspace before `bootstrap`, and its `TF_DATA_DIR`
 * keeps the `.terraform` it initialises out of `src`.
 */
const terraformInitTarget = (projectRoot: string): TargetConfiguration => {
  const toRoot = rootRelativePath(projectRoot);
  const pluginCacheDir = pluginCacheDirFor(toRoot);
  return {
    executor: 'nx:run-commands',
    options: {
      commands: [
        { command: `shx mkdir -p ${pluginCacheDir}`, forwardAllArgs: false },
        BACKENDLESS_INIT,
      ],
      forwardAllArgs: true,
      cwd: '{projectRoot}/src',
      parallel: false,
      env: {
        TF_DATA_DIR: dataDirFor(toRoot, TERRAFORM_INIT),
        TF_PLUGIN_CACHE_DIR: pluginCacheDir,
      },
    },
  };
};

/** Every command a target runs, across its options and its configurations. */
const commandsOf = (target: TargetConfiguration): string[] =>
  [target.options, ...Object.values(target.configurations ?? {})]
    .flatMap(
      (holder: { command?: unknown; commands?: unknown } | undefined) => [
        holder?.command,
        ...(Array.isArray(holder?.commands) ? holder.commands : []),
      ],
    )
    .map((command) =>
      typeof command === 'string'
        ? command
        : (command as { command?: unknown } | undefined)?.command,
    )
    .filter((command): command is string => typeof command === 'string');

/**
 * Whether the target still runs the `terraform init` this migration orders. A
 * library's `init` runs it directly and an application's delegates to the vended
 * script.
 */
const runsTerraformInit = (target: TargetConfiguration): boolean =>
  commandsOf(target).some(
    (command) =>
      command.includes('terraform init') || command.includes('scripts/init.ts'),
  );

/** Creating the plugin cache directory, which `terraform-init` now does. */
const isMakeCacheDir = (command: string) =>
  /^(shx mkdir -p|make-dir)\s/.test(command) &&
  command.includes('plugin-cache');

/**
 * Rewrites `test` or `validate` to run against the `TF_DATA_DIR` `terraform-init`
 * prepared. Only the exact shape the generator produced is rewritten: its own
 * `terraform init` (with the cache directory the plugin-cache fix added ahead of
 * it), then the one terraform command the target exists to run. Anything else is
 * the user's, and is reported instead.
 */
const migrateInitlessTarget = (
  target: TargetConfiguration,
  verb: 'test' | 'validate',
  toRoot: string,
): boolean => {
  const commands = commandsOf(target).filter(
    (command) => !isMakeCacheDir(command),
  );
  if (
    commands.length !== 2 ||
    commands[0] !== BACKENDLESS_INIT ||
    commands[1] !== `terraform ${verb}`
  ) {
    return false;
  }
  const options = target.options ?? {};
  const env: Record<string, string> = options.env ?? {};
  if (env.TF_DATA_DIR !== dataDirFor(toRoot, `terraform-${verb}`)) {
    return false;
  }

  const {
    TF_DATA_DIR: _dataDir,
    TF_PLUGIN_CACHE_DIR: _cacheDir,
    ...rest
  } = env;
  delete options.commands;
  // `parallel: false` sequenced the init ahead of the command; one command left.
  delete options.parallel;
  target.options = {
    ...options,
    command: `terraform ${verb}`,
    env: { ...rest, TF_DATA_DIR: dataDirFor(toRoot, TERRAFORM_INIT) },
  };
  return true;
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    const generator = (project.metadata as { generator?: string } | undefined)
      ?.generator;
    if (generator !== TERRAFORM_PROJECT_GENERATOR_INFO.id) continue;

    let targets = project.targets ?? {};
    const toRoot = rootRelativePath(project.root);
    let changed = false;

    // Guarded on the target being absent, so a re-run — and a project generated
    // with it — is a no-op.
    if (!targets[TERRAFORM_INIT]) {
      targets = sortObjectKeys({
        ...targets,
        [TERRAFORM_INIT]: terraformInitTarget(project.root),
      });
      changed = true;
    }

    for (const targetName of ['init', 'test', 'validate'] as const) {
      const target = targets[targetName];
      if (!target) continue;
      if (target.dependsOn?.includes(TERRAFORM_INIT)) continue;

      // `init` keeps its own backend-configured `terraform init`; `test` and
      // `validate` hand theirs over to `terraform-init`, so nothing is ordered
      // after a target whose shape is no longer recognised.
      const migrated =
        targetName === 'init'
          ? runsTerraformInit(target)
          : migrateInitlessTarget(target, targetName, toRoot);
      if (!migrated) {
        nextSteps.push(divergedStep(projectName, targetName));
        continue;
      }

      // Prepended rather than appended, so a migrated workspace matches a
      // freshly generated one.
      target.dependsOn = [TERRAFORM_INIT, ...(target.dependsOn ?? [])];
      changed = true;
    }

    if (changed) {
      updateProjectConfiguration(tree, projectName, { ...project, targets });
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
