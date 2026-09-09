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
import { REACT_WEBSITE_APP_GENERATOR_INFO } from '../../../ts/react-website/app/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  normalizeTargetKeyOrder,
  type TargetDependency,
} from '../../../utils/nx.js';
import { sortObjectKeys } from '../../../utils/object.js';

/**
 * `build` runs everything: it produces a project's deployable artifacts and runs
 * its quality gates (lint, test, typecheck). The deploy targets depended on
 * `^build`, so deploying pulled in every upstream project's gates too — work a
 * deploy does not need.
 *
 * `assemble` is the artifact-only sibling of `build`, which the deploy targets
 * depend on instead. `build` is untouched, so it remains the target that runs
 * everything.
 *
 * Each project's `assemble` is derived from what its own `build` declares rather
 * than from the generator that created it, so a project whose build has been
 * extended with an extra artifact target keeps producing it. Anything this
 * migration cannot classify is reported via `nextSteps` and left alone.
 *
 * A `compile` target depending on `^build` is also narrowed to `^compile`, which
 * is what keeps `^assemble` from pulling the upstream quality gates back in.
 *
 * How to write a migration:
 * - https://nx.dev/docs/kb/migration-generators
 * - What `nextSteps` means: https://nx.dev/docs/reference/devkit/MigrationReturnObject
 */

/**
 * Targets that produce a deployable artifact, so they belong on `assemble`.
 *
 * `bundle-migration` and `bundle-create-db-user` are the RDB bundles, which the
 * generator registers on `build` directly as well as on `bundle`.
 */
const ARTIFACT_TARGETS = [
  'compile',
  'bundle',
  'bundle-migration',
  'bundle-create-db-user',
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
 * `fmt` is the Terraform formatter, and `checkov` scans what the build has
 * already produced, so neither produces an artifact of its own.
 */
const QUALITY_GATES = ['lint', 'format', 'fmt', 'test', 'typecheck', 'checkov'];

/** The CDK targets whose `^build` becomes `^assemble`. */
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
 * The `assemble` dependencies derived from a project's `build`.
 *
 * Returns `'unclassifiable'` when `build` declares something this migration
 * cannot classify, so the caller reports it rather than guessing. A `build` that
 * declares nothing at all is not unclassifiable — it yields an empty list, and
 * the project gets a no-op `assemble`.
 */
const assembleDependenciesFor = (
  build: ProjectConfiguration['targets'][string] | undefined,
): TargetDependency[] | 'unclassifiable' => {
  const dependsOn = build?.dependsOn;
  if (dependsOn === undefined) return [];
  if (!Array.isArray(dependsOn)) return 'unclassifiable';

  const dependencies: TargetDependency[] = [];
  for (const dependency of dependsOn) {
    // The object form is valid Nx, and this plugin emits it. It names another
    // project's target explicitly, so it is classified on that target.
    if (typeof dependency !== 'string') {
      const objectTarget = (dependency as { target?: unknown })?.target;
      if (typeof objectTarget !== 'string') return 'unclassifiable';
      if (objectTarget === 'build') {
        dependencies.push({ ...dependency, target: 'assemble' });
        continue;
      }
      if (
        ARTIFACT_TARGETS.includes(objectTarget) ||
        isGenerateTarget(objectTarget)
      ) {
        dependencies.push(dependency);
        continue;
      }
      if (QUALITY_GATES.includes(objectTarget)) continue;
      return 'unclassifiable';
    }
    const [, crossProjectTarget] = dependency.match(/^.+:([^:]+)$/) ?? [];
    if (crossProjectTarget === 'build') {
      // Mirror the cross-project edge against the consumed project's own
      // `assemble`, which keeps the artifact-only chain closed.
      dependencies.push(dependency.replace(/:build$/, ':assemble'));
      continue;
    }
    if (ARTIFACT_TARGETS.includes(crossProjectTarget)) {
      // Already names an artifact target on the other project, so it carries
      // over unchanged.
      dependencies.push(dependency);
      continue;
    }
    if (crossProjectTarget && QUALITY_GATES.includes(crossProjectTarget)) {
      continue;
    }
    if (ARTIFACT_TARGETS.includes(dependency) || isGenerateTarget(dependency)) {
      dependencies.push(dependency);
      continue;
    }
    if (QUALITY_GATES.includes(dependency)) continue;
    return 'unclassifiable';
  }
  return dependencies;
};

/**
 * Adds the project's `assemble`, derived from its `build`. Returns whether the
 * project was changed.
 */
const addAssembleTarget = (
  projectName: string,
  project: ProjectConfiguration,
  nextSteps: string[],
): boolean => {
  // Already migrated. A project's own `package` target is deliberately left
  // alone: that name is for publishing to a package manager, a different job.
  if (project.targets.assemble) return false;

  // Nothing to derive an `assemble` from, so there is nothing to do. Consumers
  // reference `<project>:build`, which is untouched.
  if (!project.targets.build) return false;

  const dependencies = assembleDependenciesFor(project.targets.build);

  if (dependencies === 'unclassifiable') {
    // Consumers have already been repointed at this project's `assemble`, and Nx
    // silently skips a dependency whose target does not exist, so say so: an
    // unmigrated project here means its artifacts stop being built for a deploy.
    nextSteps.push(
      `Add an 'assemble' target to ${projectName} by hand — its 'build' target declares dependencies this migration does not recognise. It should depend on whichever of build's dependencies produce deployable artifacts, and on none of its lint/test/typecheck gates. Projects that consume ${projectName} now depend on '${projectName}:assemble', and Nx silently skips a dependency on a target that does not exist, so until you add it a deploy will not rebuild this project's artifacts.`,
    );
    return false;
  }

  project.targets.assemble = normalizeTargetKeyOrder(
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

/** Points a CDK infrastructure project's deploy targets at `^assemble`. */
const migrateCdkDeployTargets = (
  projectName: string,
  project: ProjectConfiguration,
  nextSteps: string[],
): boolean => {
  let changed = false;
  const diverged: string[] = [];

  for (const name of CDK_DEPLOY_TARGETS) {
    if (!project.targets[name]) continue;
    const result = repoint(project.targets[name], '^build', '^assemble');
    if (result === 'repointed') changed = true;
    if (result === 'diverged') diverged.push(name);
  }

  if (diverged.length > 0) {
    const targets = diverged.map((t) => `'${t}'`).join(', ');
    const singular = diverged.length === 1;
    nextSteps.push(
      `Point ${targets} on ${projectName} at '^assemble' by hand — ${singular ? 'it does' : 'they do'} not depend on '^build' as the generator left ${singular ? 'it' : 'them'}.`,
    );
  }
  return changed;
};

/**
 * Points a Terraform application's `plan` at `assemble`, so planning no longer
 * runs the module tests.
 */
const migrateTerraformPlanTarget = (
  projectName: string,
  project: ProjectConfiguration,
  nextSteps: string[],
): boolean => {
  const result = repoint(project.targets.plan, 'build', 'assemble');
  if (result === 'diverged') {
    nextSteps.push(
      `Point 'plan' on ${projectName} at 'assemble' by hand — it does not depend on 'build' as the generator left it.`,
    );
  }
  return result === 'repointed';
};

/**
 * A website's `compile` needs its dependencies' declarations, which `compile`
 * emits — not their lint or test results. Narrowing it is what keeps `^assemble`
 * from pulling the upstream quality gates back in.
 *
 * Keyed off the target's shape rather than the generator, so a project that
 * adopted the same `^build` compile is narrowed too. A project the plugin did
 * not generate is reported, since its `compile` may depend on `^build` for a
 * reason this migration cannot see.
 */
const narrowCompileTarget = (
  projectName: string,
  project: ProjectConfiguration,
  nextSteps: string[],
): boolean => {
  if (repoint(project.targets.compile, '^build', '^compile') !== 'repointed') {
    return false;
  }
  if (!generatedBy(project, REACT_WEBSITE_APP_GENERATOR_INFO.id)) {
    nextSteps.push(
      `Narrowed 'compile' on ${projectName} from '^build' to '^compile', so it no longer waits for its dependencies' lint and test targets. Revert it if that project's compile relied on an upstream step that only 'build' runs.`,
    );
  }
  return true;
};

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const nextSteps: string[] = [];

  for (const [projectName, project] of getProjects(tree)) {
    project.targets ??= {};

    let changed = addAssembleTarget(projectName, project, nextSteps);

    if (generatedBy(project, INFRA_APP_GENERATOR_INFO.id)) {
      // `synth` is the cloud assembly, so it belongs on `assemble`; `checkov`
      // scans that assembly and stays a `build`-only gate.
      const assemble = project.targets.assemble;
      if (assemble?.dependsOn && !assemble.dependsOn.includes('synth')) {
        assemble.dependsOn.push('synth');
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

    changed = narrowCompileTarget(projectName, project, nextSteps) || changed;

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
