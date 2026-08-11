/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { INFRA_APP_GENERATOR_INFO } from '../../../infra/app/generator';
import { captureGritQLVariable } from '../../../utils/ast';
import { formatFilesInSubtree } from '../../../utils/format';
import { normalizeTargetKeyOrder } from '../../../utils/nx';
import { sortObjectKeys } from '../../../utils/object';

/**
 * CDK infrastructure projects gained a `deploy-sandbox` target, which deploys the
 * sandbox stage without the user having to spell out its stage pattern
 * (`nx deploy-sandbox infra` rather than `nx deploy infra "my-app-infra-sandbox/*"`).
 *
 * The stage id is read from `main.ts` rather than recomputed from the project
 * name, so a project whose sandbox stage has been renamed gets a target that
 * deploys the stage it actually declares.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 */

const TARGET = 'deploy-sandbox';

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

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    const generator = (project.metadata as { generator?: string } | undefined)
      ?.generator;
    if (
      generator !== INFRA_APP_GENERATOR_INFO.id ||
      project.targets?.[TARGET]
    ) {
      // Not a CDK infrastructure project, or the target is already present.
      continue;
    }

    // The new target mirrors `deploy`, so it inherits whatever that resolved to
    // when the project was generated: the `tsx` credential-resolving script
    // under `stageConfig`, plain `cdk deploy` otherwise.
    const deploy = project.targets.deploy;
    const command = deploy?.options?.command;
    const mainPath = joinPathFragments(project.root, 'src/main.ts');
    const stageId = await sandboxStageId(tree, project.root);

    if (typeof command !== 'string') {
      nextSteps.push(
        `Add a '${TARGET}' target to ${projectName} by hand if necessary — its 'deploy' target no longer matches the shape the generator produced.`,
      );
      continue;
    }
    if (!stageId) {
      nextSteps.push(
        `Add a '${TARGET}' target to ${projectName} by hand if necessary — no sandbox stage was found in ${mainPath}.`,
      );
      continue;
    }

    project.targets[TARGET] = normalizeTargetKeyOrder({
      executor: deploy.executor,
      ...(deploy.dependsOn ? { dependsOn: [...deploy.dependsOn] } : {}),
      // Quoted so the shell does not glob the `*`.
      options: { ...deploy.options, command: `${command} "${stageId}/*"` },
    });
    updateProjectConfiguration(tree, projectName, {
      ...project,
      targets: sortObjectKeys(project.targets),
    });
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
