/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  OverwriteStrategy,
  type TargetConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { relative } from 'path';
import { TERRAFORM_PROJECT_GENERATOR_INFO } from '../../../terraform/project/generator.js';
import {
  addDestructuredImport,
  applyGritQL,
  matchGritQL,
} from '../../../utils/ast.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { kebabCase } from '../../../utils/names.js';

/**
 * Terraform projects share their provider downloads through
 * `TF_PLUGIN_CACHE_DIR`, so a `terraform init` whose `.terraform` was cleaned
 * links the providers already on disk instead of re-downloading them. The AWS
 * provider alone is several hundred megabytes, which dominated the `test`
 * target's runtime on every cache miss.
 *
 * The cache lives under the already-gitignored `.terraform` at the workspace
 * root. Terraform reports an error and silently falls back to downloading when
 * the directory does not exist, so each target creates it first, and the vended
 * `init` script gets an `env` helper that does the same.
 *
 * Nx does not interpolate `{workspaceRoot}` inside `env`, so the value is
 * relative to the target's own `cwd` of `{projectRoot}/src`.
 */

const TF_PLUGIN_CACHE_DIR = 'TF_PLUGIN_CACHE_DIR';

const divergedStep = (projectName: string, targetName: string) =>
  `${projectName}: its '${targetName}' target no longer matches the shape the generator produced - left untouched. To share provider downloads, set the \`TF_PLUGIN_CACHE_DIR\` env var to the workspace root's \`.terraform/plugin-cache\` (relative to the target's \`cwd\`), creating that directory before \`terraform init\` runs.`;

/** Path to the shared cache from a target running in `{projectRoot}/src`. */
const pluginCacheDirFor = (projectRoot: string) =>
  joinPathFragments(
    relative(joinPathFragments(projectRoot, 'src'), '.') || '.',
    '.terraform',
    'plugin-cache',
  ).replace(/\\/g, '/');

/** Whether a target already runs the command, however it is expressed. */
const hasCommand = (
  commands: unknown,
  predicate: (command: string) => boolean,
): boolean =>
  Array.isArray(commands) &&
  commands.some((c) => {
    const command = typeof c === 'string' ? c : (c?.command as string);
    return typeof command === 'string' && predicate(command);
  });

/**
 * Prepend the `make-dir` that creates the cache directory. `forwardAllArgs` is
 * off for it alone, so args meant for `terraform` are not passed to `make-dir`.
 */
const withMakeDir = (commands: unknown[], pluginCacheDir: string) => [
  { command: `make-dir ${pluginCacheDir}`, forwardAllArgs: false },
  ...commands,
];

/**
 * The `terraform init` call in the vended `init` script, matched structurally so
 * formatting and argument layout don't affect whether it is recognised.
 */
const INIT_CALL =
  "`execFileSync('terraform', [$args], { cwd: srcDir, stdio: 'inherit' })`";
const INIT_CALL_WITH_ENV =
  "`execFileSync('terraform', [$args], { cwd: srcDir, stdio: 'inherit', env: pluginCacheEnv() })`";

const divergedScriptStep = (filePath: string) =>
  `${filePath}: its \`terraform init\` call no longer matches the shape the generator produced - left untouched. Pass \`env: pluginCacheEnv()\` to that \`execFileSync\` so it shares the provider cache in \`scripts/env.ts\`.`;

/**
 * Route the vended `init` script's `terraform init` through the shared cache.
 *
 * Guarded on the helper not already being imported, so a re-run — and a project
 * generated with the cache — is a no-op.
 */
const migrateInitScript = async (
  tree: Tree,
  filePath: string,
  nextSteps: string[],
): Promise<void> => {
  if (!tree.exists(filePath)) return;
  if (await matchGritQL(tree, filePath, '`pluginCacheEnv()`')) return;

  if (!(await matchGritQL(tree, filePath, INIT_CALL))) {
    nextSteps.push(divergedScriptStep(filePath));
    return;
  }

  await applyGritQL(tree, filePath, `${INIT_CALL} => ${INIT_CALL_WITH_ENV}`);

  // Placed in the generator's import position rather than prepended, so a
  // migrated workspace matches a freshly generated one.
  const awsConfigImport = "`import { resolveAwsConfig } from './aws-config'`";
  if (await matchGritQL(tree, filePath, awsConfigImport)) {
    await applyGritQL(
      tree,
      filePath,
      `${awsConfigImport} => \`import { resolveAwsConfig } from './aws-config';\nimport { pluginCacheEnv } from './env'\``,
    );
  } else {
    await addDestructuredImport(tree, filePath, ['pluginCacheEnv'], './env');
  }
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    const generator = (project.metadata as { generator?: string } | undefined)
      ?.generator;
    if (generator !== TERRAFORM_PROJECT_GENERATOR_INFO.id) continue;

    const targets = project.targets ?? {};
    const pluginCacheDir = pluginCacheDirFor(project.root);
    let changed = false;

    /**
     * Wire the cache into a target that runs `terraform init`. Only the exact
     * shape the generator produced is rewritten; anything else is the user's and
     * is reported instead. Guarded on the env var being absent, so a re-run —
     * and a project already generated with the cache — is a no-op.
     */
    const migrateTarget = (
      targetName: string,
      target: TargetConfiguration | undefined,
      /** Where the commands live: on the target, or under a configuration. */
      commandsHolder: { commands?: unknown; env?: Record<string, string> },
      env: Record<string, string> | undefined,
    ) => {
      if (!target) return;
      if (env?.[TF_PLUGIN_CACHE_DIR]) return;

      if (
        !hasCommand(commandsHolder.commands, (c) =>
          c.includes('terraform init'),
        )
      ) {
        nextSteps.push(divergedStep(projectName, targetName));
        return;
      }

      commandsHolder.commands = withMakeDir(
        commandsHolder.commands as unknown[],
        pluginCacheDir,
      );
      target.options = {
        ...target.options,
        parallel: false,
        env: { ...target.options?.env, [TF_PLUGIN_CACHE_DIR]: pluginCacheDir },
      };
      changed = true;
    };

    // `test` carries its `terraform init -backend=false` on the target itself.
    const test = targets.test;
    if (test?.options) {
      migrateTarget('test', test, test.options, test.options.env);
    }

    // `init` carries its command under the `dev` configuration. A library's
    // runs `terraform init` directly; an application's delegates to the vended
    // script, which reads the cache from its own helper rather than the target.
    const init = targets.init;
    const initDev = init?.configurations?.dev;
    if (init?.options && initDev) {
      const isScriptDriven = hasCommand(
        initDev.commands ?? init.options.commands,
        (c) => c.includes('scripts/init.ts'),
      );
      if (!isScriptDriven) {
        // The pre-fix generator vended a single `command`; normalise it to the
        // `commands` array `make-dir` has to be prepended to.
        if (typeof initDev.command === 'string' && !initDev.commands) {
          initDev.commands = [initDev.command];
          delete initDev.command;
        }
        migrateTarget('init', init, initDev, init.options.env);
      }
    }

    if (changed) {
      updateProjectConfiguration(tree, projectName, { ...project, targets });
    }

    // An application's `init` target runs `terraform init` from the vended
    // script rather than the target, so the cache reaches it via the `env`
    // helper. The helper is new, so KeepExisting adds it while leaving a user's
    // own copy alone; the script that calls it already exists, so it is
    // rewritten below.
    if (tree.exists(joinPathFragments(project.root, 'bootstrap'))) {
      generateFiles(
        tree,
        joinPathFragments(
          import.meta.dirname,
          '../../../terraform/project/files/application/scripts',
        ),
        joinPathFragments(project.root, 'scripts'),
        { stateKeyPrefix: kebabCase(projectName) },
        { overwriteStrategy: OverwriteStrategy.KeepExisting },
      );

      await migrateInitScript(
        tree,
        joinPathFragments(project.root, 'scripts', 'init.ts'),
        nextSteps,
      );
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
