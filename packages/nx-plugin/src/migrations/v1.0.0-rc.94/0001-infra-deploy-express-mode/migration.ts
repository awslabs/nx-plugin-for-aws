/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  type MigrationReturnObject,
  type TargetConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { INFRA_APP_GENERATOR_INFO } from '../../../infra/app/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * Deploy using CloudFormation express mode from the deploy-sandbox target of
 * ts#infra projects, and wait for full stabilization everywhere else.
 *
 * Express mode completes each resource operation as soon as its configuration is
 * applied rather than waiting for full stabilization, which is a much faster
 * iteration cycle for development deploys. It returns before resources have
 * settled, so it suits only the stage you iterate on.
 *
 * `deploy-sandbox` therefore gets it, since it only ever deploys the sandbox
 * stage. `deploy` names whichever stage you give it, including beta and prod, and
 * `deploy-ci` runs from a pipeline - both wait for full stabilization.
 */

const EXPRESS_FLAG = '--express';
const NO_EXPRESS_FLAG = '--no-express';

/** Whether `deploy-sandbox` should carry the flag, and `deploy` should not. */
const WANTS_EXPRESS: Record<string, boolean> = {
  'deploy-sandbox': true,
  deploy: false,
};

/**
 * Whether the command is one of the deploy commands this migration vends -
 * either a direct `cdk deploy`, or the stage-config `infra-deploy.ts` script
 * that wraps it. Anything else has been hand-written and is reported rather
 * than rewritten.
 */
const isGeneratedDeployCommand = (command: string): boolean =>
  /(^|\s)cdk\s+deploy(\s|$)/.test(command) ||
  command.includes('infra-deploy.ts');

const divergedNextStep = (
  projectName: string,
  target: string,
  wantsExpress: boolean,
): string =>
  wantsExpress
    ? `${projectName}: its ${target} target has been customised, so it was left as it is. Add "${EXPRESS_FLAG}" to the target's command to deploy using CloudFormation express mode.`
    : `${projectName}: its ${target} target has been customised, so it was left as it is. Remove "${EXPRESS_FLAG}" from the target's command so it waits for full resource stabilization - this target can name any stage, including production.`;

/** Drops the flag wherever it sits, leaving the rest of the command untouched. */
const withoutExpress = (command: string): string =>
  command
    .split(/\s+/)
    .filter((arg) => arg !== EXPRESS_FLAG)
    .join(' ');

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];
  let migrated = false;

  for (const [name, project] of getProjects(tree)) {
    if (
      (project.metadata as { generator?: string } | undefined)?.generator !==
      INFRA_APP_GENERATOR_INFO.id
    ) {
      continue;
    }

    let projectChanged = false;

    for (const [targetName, wantsExpress] of Object.entries(WANTS_EXPRESS)) {
      const target: TargetConfiguration | undefined =
        project.targets?.[targetName];
      const command = target?.options?.command;
      if (!target || typeof command !== 'string') {
        continue;
      }

      const args = command.split(/\s+/);
      const hasExpress = args.includes(EXPRESS_FLAG);

      // Already in the wanted state, so re-running - and a project generated
      // after this change - is a no-op.
      if (hasExpress === wantsExpress) {
        continue;
      }

      // `--no-express` is a deliberate opt-out, so honour it rather than
      // flipping the user back to express mode.
      if (wantsExpress && args.includes(NO_EXPRESS_FLAG)) {
        continue;
      }

      if (!isGeneratedDeployCommand(command)) {
        nextSteps.push(divergedNextStep(name, targetName, wantsExpress));
        continue;
      }

      // Appended last so it stays clear of the stage pattern, which the
      // stage-config deploy script reads from the first positional argument.
      target.options.command = wantsExpress
        ? `${command} ${EXPRESS_FLAG}`
        : withoutExpress(command);
      projectChanged = true;
    }

    if (projectChanged) {
      updateProjectConfiguration(tree, name, project);
      migrated = true;
    }
  }

  if (migrated) {
    await formatFilesInSubtree(tree);
  }

  return { nextSteps };
}
