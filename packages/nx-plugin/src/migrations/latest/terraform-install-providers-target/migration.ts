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
 * `init`, `test` and `validate` each run their own `terraform init` against one
 * per-project cache, and Nx schedules them concurrently — `plan` depends on both
 * `init` and `validate`. Two `terraform init` runs filling the cache at once each
 * compute a different hash for the same provider, because the hash covers a
 * directory the other is still writing, and terraform then rejects the mismatch
 * against the lock file: "the cached package ... does not match any of the
 * checksums recorded in the dependency lock file".
 *
 * The new `install-providers` target downloads the providers once, and the three
 * targets that need them depend on it, so by the time they run the cache is warm
 * and they only link out of it.
 */

const INSTALL_PROVIDERS = 'install-providers';

/** The targets that run `terraform init` and so must wait for the cache. */
const DEPENDENT_TARGETS = ['init', 'test', 'validate'] as const;

const divergedStep = (projectName: string, targetName: string) =>
  `${projectName}: its '${targetName}' target no longer matches the shape the generator produced - left untouched. Add \`"dependsOn": ["${INSTALL_PROVIDERS}"]\` to it so its \`terraform init\` runs against a warm provider cache.`;

/** Path from a target running in `{projectRoot}/src` back to the workspace root. */
const rootRelativePath = (projectRoot: string) =>
  (relative(joinPathFragments(projectRoot, 'src'), '.') || '.').replace(
    /\\/g,
    '/',
  );

/**
 * The target as the generator vends it: `-backend=false` needs no credentials,
 * so this runs on a fresh workspace before `bootstrap`, and its `TF_DATA_DIR`
 * keeps the `.terraform` it initialises out of `src`.
 */
const installProvidersTarget = (projectRoot: string): TargetConfiguration => {
  const toRoot = rootRelativePath(projectRoot);
  const pluginCacheDir = joinPathFragments(
    toRoot,
    '.terraform',
    'plugin-cache',
    '{projectRoot}',
  );
  return {
    executor: 'nx:run-commands',
    options: {
      commands: [
        { command: `shx mkdir -p ${pluginCacheDir}`, forwardAllArgs: false },
        'terraform init -backend=false',
      ],
      forwardAllArgs: true,
      cwd: '{projectRoot}/src',
      parallel: false,
      env: {
        TF_DATA_DIR: joinPathFragments(
          toRoot,
          'dist',
          '{projectRoot}',
          'terraform-providers',
        ),
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
 * library's `init` runs it directly, an application's delegates to the vended
 * script, and `test` and `validate` run it with `-backend=false`.
 */
const runsTerraformInit = (target: TargetConfiguration): boolean =>
  commandsOf(target).some(
    (command) =>
      command.includes('terraform init') || command.includes('scripts/init.ts'),
  );

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    const generator = (project.metadata as { generator?: string } | undefined)
      ?.generator;
    if (generator !== TERRAFORM_PROJECT_GENERATOR_INFO.id) continue;

    let targets = project.targets ?? {};
    let changed = false;

    // Guarded on the target being absent, so a re-run — and a project generated
    // with it — is a no-op.
    if (!targets[INSTALL_PROVIDERS]) {
      targets = sortObjectKeys({
        ...targets,
        [INSTALL_PROVIDERS]: installProvidersTarget(project.root),
      });
      changed = true;
    }

    for (const targetName of DEPENDENT_TARGETS) {
      const target = targets[targetName];
      if (!target) continue;
      if (target.dependsOn?.includes(INSTALL_PROVIDERS)) continue;

      if (!runsTerraformInit(target)) {
        nextSteps.push(divergedStep(projectName, targetName));
        continue;
      }

      // Prepended rather than appended, so a migrated workspace matches a
      // freshly generated one.
      target.dependsOn = [INSTALL_PROVIDERS, ...(target.dependsOn ?? [])];
      changed = true;
    }

    if (changed) {
      updateProjectConfiguration(tree, projectName, { ...project, targets });
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
