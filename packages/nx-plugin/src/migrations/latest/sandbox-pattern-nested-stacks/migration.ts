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
 * Widen the stage pattern of the sandbox targets of ts#infra projects from
 * `<stage>/*` to `<stage>/**`.
 *
 * A single `*` matches the stage's own stacks but nothing below them, so it
 * misses stacks a construct creates inside a stack - such as the `us-east-1`
 * WebACL stack a website creates for its CloudFront distribution.
 * `cdk destroy` only deletes the stacks its pattern selects, so
 * `destroy-sandbox` left that stack, and the WebACL it bills for, deployed.
 */

const SANDBOX_TARGETS = ['deploy-sandbox', 'destroy-sandbox'];

/** A quoted or bare stage pattern ending in a single `*`, ie `"my-sandbox/*"`. */
const SINGLE_STAR_PATTERN = /^("?)\S+\/\*\1$/;

const widen = (token: string): string => token.replace(/\/\*("?)$/, '/**$1');

/**
 * Whether the command is one of the deploy/destroy commands this generator
 * vends - either a direct `cdk deploy`/`cdk destroy`, or the stage-config
 * script that wraps it. Anything else has been hand-written and is reported
 * rather than rewritten.
 */
const isGeneratedCommand = (command: string): boolean =>
  /(^|\s)cdk\s+(deploy|destroy)(\s|$)/.test(command) ||
  command.includes('infra-deploy.ts') ||
  command.includes('infra-destroy.ts');

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

    for (const targetName of SANDBOX_TARGETS) {
      const target: TargetConfiguration | undefined =
        project.targets?.[targetName];
      const command = target?.options?.command;
      if (!target || typeof command !== 'string') {
        continue;
      }

      const args = command.split(/\s+/);
      // Nothing to widen: already `/**`, or the pattern has been removed. Keeps
      // re-runs - and a project generated after this change - a no-op.
      if (!args.some((arg) => SINGLE_STAR_PATTERN.test(arg))) {
        continue;
      }

      if (!isGeneratedCommand(command)) {
        nextSteps.push(
          `${name}: its ${targetName} target has been customised, so it was left as it is. Widen its stage pattern from "<stage>/*" to "<stage>/**" so it also matches stacks nested below the stage's stacks, such as a website's WebACL stack.`,
        );
        continue;
      }

      target.options.command = args
        .map((arg) => (SINGLE_STAR_PATTERN.test(arg) ? widen(arg) : arg))
        .join(' ');
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
