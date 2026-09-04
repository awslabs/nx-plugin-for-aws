/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type ProjectConfiguration,
  type TargetConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { relative } from 'path';
import { TERRAFORM_PROJECT_GENERATOR_INFO } from '../../../terraform/project/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * Run `validate` against a backendless `terraform init` of its own, so it works
 * on a fresh workspace.
 *
 * It previously depended on the `init` target. On an application project that
 * runs the vended `scripts/init.ts`, which configures the S3 backend and fails
 * with a raw `NoSuchBucket` trace until `bootstrap` has created the state
 * bucket — so the first target the guide invites the reader to try was
 * unrunnable, while `lint`, `test` and `checkov` all worked.
 *
 * `-backend=false` installs the modules and providers validation needs without
 * configuring the backend, exactly as `test` already does, so no credentials are
 * involved. `TF_DATA_DIR` keeps that `.terraform` out of `src` so it never races
 * the backend-configured targets over the shared one, and the shared plugin
 * cache means the providers are linked rather than re-downloaded.
 */

const VALIDATE_TARGET = 'validate';

/** The command the pre-fix target ran, on its own. */
const VENDED_COMMAND = 'terraform validate';

const divergedMessage = (projectName: string) =>
  `${projectName}:${VALIDATE_TARGET}: has diverged from the generated shape - left untouched. To run it before \`bootstrap\`, have it run \`terraform init -backend=false\` ahead of \`terraform validate\` rather than depending on the \`init\` target, which configures the S3 backend.`;

/** Path from a target running in `{projectRoot}/src` to the workspace root. */
const rootRelativePathFrom = (projectRoot: string) =>
  (relative(joinPathFragments(projectRoot, 'src'), '.') || '.').replace(
    /\\/g,
    '/',
  );

/** Whether the target is the exact shape the pre-fix generator produced. */
const hasVendedShape = (target: TargetConfiguration): boolean =>
  target.executor === 'nx:run-commands' &&
  target.options?.command === VENDED_COMMAND &&
  !target.options?.commands &&
  target.options?.cwd === '{projectRoot}/src' &&
  target.dependsOn?.length === 1 &&
  target.dependsOn[0] === 'init';

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    const generator = (project.metadata as { generator?: string } | undefined)
      ?.generator;
    if (generator !== TERRAFORM_PROJECT_GENERATOR_INFO.id) continue;

    const target = project.targets?.[VALIDATE_TARGET];
    if (!target) continue;

    // A target already running its own init needs nothing, which also makes a
    // re-run — and a project generated after the fix — a no-op.
    if (target.options?.env?.TF_DATA_DIR) continue;

    if (!hasVendedShape(target)) {
      nextSteps.push(divergedMessage(projectName));
      continue;
    }

    const rootRelativePath = rootRelativePathFrom(project.root);
    const pluginCacheDir = joinPathFragments(
      rootRelativePath,
      '.terraform',
      'plugin-cache',
      '{projectRoot}',
    ).replace(/\\/g, '/');
    const validateDataDir = joinPathFragments(
      rootRelativePath,
      'dist',
      '{projectRoot}',
      'terraform-validate',
    ).replace(/\\/g, '/');

    const { command: _command, ...options } = target.options;
    const { dependsOn: _dependsOn, ...rest } = target;

    project.targets[VALIDATE_TARGET] = {
      ...rest,
      // `^production` mirrors `test`: validation resolves the relative modules a
      // project consumes, so a change in one must invalidate it.
      inputs: ['default', '^production'],
      // `TF_DATA_DIR` is terraform's working directory, not an artifact — its
      // provider entries are symlinks into the shared plugin cache.
      outputs: [],
      options: {
        ...options,
        commands: [
          { command: `shx mkdir -p ${pluginCacheDir}`, forwardAllArgs: false },
          'terraform init -backend=false',
          VENDED_COMMAND,
        ],
        parallel: false,
        env: {
          ...options.env,
          TF_DATA_DIR: validateDataDir,
          TF_PLUGIN_CACHE_DIR: pluginCacheDir,
        },
      },
    };

    updateProjectConfiguration(
      tree,
      projectName,
      project as ProjectConfiguration,
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
