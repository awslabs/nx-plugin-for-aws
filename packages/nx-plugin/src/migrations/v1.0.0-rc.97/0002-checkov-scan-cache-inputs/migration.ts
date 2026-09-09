/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  type MigrationReturnObject,
  type ProjectConfiguration,
  type TargetConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { INFRA_APP_GENERATOR_INFO } from '../../../infra/app/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';

/**
 * Point the CDK infrastructure `checkov` target's cache inputs at the project
 * rather than at the synth output directory.
 *
 * The target declared `["{workspaceRoot}/dist/{projectRoot}/cdk.out"]`, a
 * fileset input. Nx resolves a fileset against the files it tracks, and `dist`
 * is gitignored — so the input matched nothing and hashed to a constant. Once
 * the scan had been cached, every later run was a hit: adding a non-compliant
 * resource to a stack left `build` reporting success, and restored a
 * `checkov_report.json` recording zero resources scanned.
 *
 * `["default"]` is what its `synth` sibling declares. It covers the project's
 * own sources and carries the transitive `dependentTasksOutputFiles` entry from
 * `nx.json`, which Nx resolves against the upstream `synth` task — so the hash
 * follows the template the scan actually reads.
 */

const CHECKOV_TARGET = 'checkov';

/** The inputs the pre-fix generator declared, replaced in place. */
const VENDED_INPUTS = ['{workspaceRoot}/dist/{projectRoot}/cdk.out'];

/** The inputs the generator declares now, matching the `synth` sibling. */
const FIXED_INPUTS = ['default'];

const divergedMessage = (projectName: string) =>
  `${projectName}:${CHECKOV_TARGET}: its \`inputs\` have diverged from the generated shape - left untouched. Confirm they cover the synthesized template the scan reads: an input pointed only at \`dist\` matches no tracked file, so the scan can report a cached pass on infrastructure it never scanned.`;

/** Whether a target's inputs are exactly the ones the generator vended. */
const hasVendedInputs = (target: TargetConfiguration): boolean =>
  Array.isArray(target.inputs) &&
  target.inputs.length === VENDED_INPUTS.length &&
  target.inputs.every((input, index) => input === VENDED_INPUTS[index]);

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    const generator = (project.metadata as { generator?: string } | undefined)
      ?.generator;
    if (generator !== INFRA_APP_GENERATOR_INFO.id) continue;

    const target = project.targets?.[CHECKOV_TARGET];
    if (!target) continue;

    // A target already declaring the fixed inputs needs nothing, which also
    // makes a re-run — and a project generated after the fix — a no-op.
    if (
      Array.isArray(target.inputs) &&
      target.inputs.length === FIXED_INPUTS.length &&
      target.inputs.every((input, index) => input === FIXED_INPUTS[index])
    ) {
      continue;
    }

    if (!hasVendedInputs(target)) {
      nextSteps.push(divergedMessage(projectName));
      continue;
    }

    target.inputs = [...FIXED_INPUTS];
    updateProjectConfiguration(
      tree,
      projectName,
      project as ProjectConfiguration,
    );
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
