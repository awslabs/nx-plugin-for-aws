/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  type MigrationReturnObject,
  type ProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { INFRA_APP_GENERATOR_INFO } from '../../../infra/app/generator.js';
import { TERRAFORM_PROJECT_GENERATOR_INFO } from '../../../terraform/project/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { normalizeTargetKeyOrder } from '../../../utils/nx.js';
import { sortObjectKeys } from '../../../utils/object.js';

/**
 * `build` runs everything: it produces a project's deployable artifacts and runs
 * its quality gates (lint, test, typecheck). The deploy targets depended on
 * `^build`, so deploying pulled in every upstream project's gates too — work a
 * deploy does not need.
 *
 * `package` is the artifact-only sibling of `build`, which the deploy targets
 * depend on instead. `build` is untouched, so it remains the target that runs
 * everything.
 *
 * Each project's `package` is derived from what its own `build` declares rather
 * than from the generator that created it, so a project whose build has been
 * extended with an extra artifact target keeps producing it. Anything this
 * migration cannot classify is reported via `nextSteps` and left alone.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 */

/** Targets that produce a deployable artifact, so they belong on `package`. */
const ARTIFACT_TARGETS = [
  'compile',
  'bundle',
  'docker',
  'openapi',
  'operations',
  'synth',
  'generate-ssdk',
];

/**
 * Targets that check the code rather than produce an artifact. Listed so an
 * unrecognised entry is reported rather than silently classified either way.
 *
 * `fmt` is the Terraform formatter, and `checkov` scans the CDK cloud assembly
 * once `synth` has written it, so neither produces an artifact of its own.
 */
const QUALITY_GATES = ['lint', 'format', 'fmt', 'test', 'typecheck', 'checkov'];

/**
 * On Terraform, `checkov` is a security control an interactive `plan` should
 * still run, so it stays on the artifact path. On CDK it runs after `synth` and
 * outside the deploy path, which this preserves.
 */
const TERRAFORM_ARTIFACT_TARGETS = ['checkov'];

/** The CDK targets whose `^build` becomes `^package`. */
const CDK_DEPLOY_TARGETS = [
  'synth',
  'deploy',
  'deploy-sandbox',
  'destroy',
  'destroy-sandbox',
];

/** True when the project was created by the given generator. */
const generatedBy = (project: ProjectConfiguration, id: string): boolean =>
  (project.metadata as { generator?: string } | undefined)?.generator === id;

/**
 * `generate:<name>` targets write generated source (an API client, operations
 * metadata) that the infrastructure reads, so they produce artifacts.
 */
const isGenerateTarget = (target: string): boolean =>
  target.startsWith('generate:') || target === 'generate';

/**
 * The `package` dependencies derived from a project's `build`. Returns undefined
 * when `build` declares something this migration cannot classify, so the caller
 * reports it rather than guessing.
 */
const packageDependenciesFor = (
  build: ProjectConfiguration['targets'][string] | undefined,
  artifactTargets: string[],
): string[] | undefined => {
  const dependsOn = build?.dependsOn;
  if (!Array.isArray(dependsOn)) return undefined;

  const dependencies: string[] = [];
  for (const dependency of dependsOn) {
    if (typeof dependency !== 'string') return undefined;
    const [, crossProjectTarget] = dependency.match(/^.+:([^:]+)$/) ?? [];
    if (crossProjectTarget === 'build') {
      // Mirror the cross-project edge against the consumed project's own
      // `package`, which keeps the artifact-only chain closed.
      dependencies.push(dependency.replace(/:build$/, ':package'));
      continue;
    }
    if (artifactTargets.includes(crossProjectTarget)) {
      // Already names an artifact target on the other project, so it carries
      // over unchanged.
      dependencies.push(dependency);
      continue;
    }
    if (crossProjectTarget && QUALITY_GATES.includes(crossProjectTarget)) {
      continue;
    }
    if (artifactTargets.includes(dependency) || isGenerateTarget(dependency)) {
      dependencies.push(dependency);
      continue;
    }
    if (QUALITY_GATES.includes(dependency)) continue;
    return undefined;
  }
  return dependencies;
};

/**
 * Adds the project's `package`, derived from its `build`. Returns whether the
 * project was changed.
 */
const addPackageTarget = (
  projectName: string,
  project: ProjectConfiguration,
  nextSteps: string[],
): boolean => {
  // Already migrated, or the project authors its own `package` (an Nx plugin
  // project publishes one), so it is the user's to keep.
  if (project.targets.package) return false;

  const isTerraform = generatedBy(project, TERRAFORM_PROJECT_GENERATOR_INFO.id);

  const dependencies = packageDependenciesFor(
    project.targets.build,
    isTerraform
      ? [...ARTIFACT_TARGETS, ...TERRAFORM_ARTIFACT_TARGETS]
      : ARTIFACT_TARGETS,
  );

  if (!dependencies) {
    nextSteps.push(
      `Add a 'package' target to ${projectName} by hand — its 'build' target declares dependencies this migration does not recognise. It should depend on whichever of build's dependencies produce deployable artifacts, and on none of its lint/test/typecheck gates.`,
    );
    return false;
  }

  project.targets.package = normalizeTargetKeyOrder(
    dependencies.length > 0
      ? { dependsOn: dependencies }
      : { executor: 'nx:noop' },
  );
  return true;
};

/** Repoints one entry of a target's `dependsOn`. */
const repoint = (
  target: ProjectConfiguration['targets'][string] | undefined,
  from: string,
  to: string,
): 'repointed' | 'already' | 'diverged' => {
  const dependsOn = target?.dependsOn;
  if (!Array.isArray(dependsOn)) return 'diverged';
  if (dependsOn.includes(to)) return 'already';
  const index = dependsOn.indexOf(from);
  if (index === -1) return 'diverged';
  dependsOn[index] = to;
  return 'repointed';
};

/** Points a CDK infrastructure project's deploy targets at `^package`. */
const migrateCdkDeployTargets = (
  projectName: string,
  project: ProjectConfiguration,
  nextSteps: string[],
): boolean => {
  let changed = false;
  const diverged: string[] = [];

  for (const name of CDK_DEPLOY_TARGETS) {
    if (!project.targets[name]) continue;
    const result = repoint(project.targets[name], '^build', '^package');
    if (result === 'repointed') changed = true;
    if (result === 'diverged') diverged.push(name);
  }

  if (diverged.length > 0) {
    const targets = diverged.map((t) => `'${t}'`).join(', ');
    const plural = diverged.length === 1;
    nextSteps.push(
      `Point ${targets} on ${projectName} at '^package' by hand — ${plural ? 'it does' : 'they do'} not depend on '^build' as the generator left ${plural ? 'it' : 'them'}.`,
    );
  }
  return changed;
};

/**
 * Points a Terraform application's `plan` at `package`, so planning no longer
 * runs the module tests.
 */
const migrateTerraformPlanTarget = (
  projectName: string,
  project: ProjectConfiguration,
  nextSteps: string[],
): boolean => {
  const result = repoint(project.targets.plan, 'build', 'package');
  if (result === 'diverged') {
    nextSteps.push(
      `Point 'plan' on ${projectName} at 'package' by hand — it does not depend on 'build' as the generator left it.`,
    );
  }
  return result === 'repointed';
};

/**
 * A website's `compile` needs its dependencies' declarations, which `compile`
 * emits — not their lint or test results. Narrowing it is what keeps `^package`
 * from pulling the upstream quality gates back in.
 *
 * Keyed off the target's shape rather than the generator, so a project that
 * adopted the same `^build` compile is narrowed too.
 */
const narrowCompileTarget = (project: ProjectConfiguration): boolean =>
  repoint(project.targets.compile, '^build', '^compile') === 'repointed';

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    project.targets ??= {};

    let changed = addPackageTarget(projectName, project, nextSteps);

    if (generatedBy(project, INFRA_APP_GENERATOR_INFO.id)) {
      // `synth` is the cloud assembly, so it belongs on `package`; `checkov`
      // scans that assembly and stays a `build`-only gate.
      const pkg = project.targets.package;
      if (pkg?.dependsOn && !pkg.dependsOn.includes('synth')) {
        pkg.dependsOn.push('synth');
        changed = true;
      }
      changed =
        migrateCdkDeployTargets(projectName, project, nextSteps) || changed;
    }

    if (
      generatedBy(project, TERRAFORM_PROJECT_GENERATOR_INFO.id) &&
      project.projectType === 'application'
    ) {
      changed =
        migrateTerraformPlanTarget(projectName, project, nextSteps) || changed;
    }

    changed = narrowCompileTarget(project) || changed;

    if (changed) {
      updateProjectConfiguration(tree, projectName, {
        ...project,
        targets: sortObjectKeys(project.targets),
      });
    }
  }

  await formatFilesInSubtree(tree);

  return { nextSteps };
}
