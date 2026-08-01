/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as path from 'node:path';
import { getProjects, type Tree } from '@nx/devkit';
import {
  AWS_NX_PLUGIN_CONFIG_FILE_NAME,
  readAwsNxPluginConfig,
} from '../config/utils';
import {
  type DependencyDeclaration,
  type DependencyMetadata,
  ownedDependencyEntries,
} from '../declared-dependencies';
import { buildGeneratorInfoList } from '../generators';
import { CDK_ONLY_DEPENDENCIES } from '../shared-constructs-constants';

/** Directory holding `generators.json`, which maps ids to their modules. */
export const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/**
 * Which vended dependencies this workspace's generators are responsible for.
 *
 * Only these are synced, so a package the user added themselves keeps the version
 * they chose. Ownership is derived from the generators the workspace has run and
 * the dependencies each declares — nothing extra is recorded in the workspace.
 */
export interface OwnedDependencies {
  readonly ts: ReadonlySet<string>;
  readonly py: ReadonlySet<string>;
}

/**
 * One recorded run of a generator, with the metadata it wrote.
 *
 * The metadata carries the values the generator's dependency conditions read, so
 * a declaration filters down to the branch this occurrence actually took.
 */
export interface GeneratorOccurrence {
  readonly id: string;
  readonly metadata: DependencyMetadata;
}

/**
 * The workspace's IaC provider, or undefined when the config doesn't name one.
 *
 * A workspace-wide choice rather than any one generator's, so it narrows
 * ownership here instead of through a `when` predicate.
 */
const workspaceIac = (tree: Tree): string | undefined => {
  try {
    return readAwsNxPluginConfig(tree)?.iac?.provider;
  } catch {
    // A config this plugin can't evaluate must not fail the upgrade.
    return undefined;
  }
};

/**
 * Every recorded run of a generator in this workspace, from the metadata
 * generators record on the projects (and components) they create.
 *
 * A generator appears once per project or component it created, since each may
 * have been run with different options.
 *
 * `init` creates no project, so its config file stands in for it.
 */
export const generatorOccurrences = (
  tree: Tree,
): readonly GeneratorOccurrence[] => {
  const occurrences: GeneratorOccurrence[] = [];
  if (tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) {
    occurrences.push({ id: 'init', metadata: {} });
  }
  for (const [, project] of getProjects(tree)) {
    const metadata = project.metadata as
      | {
          generator?: string;
          components?: ({ generator?: string } & DependencyMetadata)[];
        }
      | undefined;
    if (metadata?.generator) {
      const { components, ...ownMetadata } = metadata;
      occurrences.push({ id: metadata.generator, metadata: ownMetadata });
    }
    for (const component of metadata?.components ?? []) {
      if (component.generator) {
        occurrences.push({ id: component.generator, metadata: component });
      }
    }
  }
  return occurrences;
};

/** Generator ids this workspace has run. */
export const generatorsRun = (tree: Tree): ReadonlySet<string> =>
  new Set(generatorOccurrences(tree).map((occurrence) => occurrence.id));

/**
 * Union of the dependencies declared by the generators this workspace has run,
 * narrowed per occurrence to those whose conditions its recorded metadata
 * satisfies — a project generated with one protocol does not own another's
 * packages.
 *
 * A `versionOnly` entry is owned like any other: it is declared precisely so the
 * sync keeps its pinned version current wherever the workspace already holds it.
 *
 * Each generator module exports its declaration, so reading one is an import
 * rather than a run — the generators themselves are never invoked.
 */
export const ownedDependencies = async (
  tree: Tree,
): Promise<OwnedDependencies> => {
  const occurrences = generatorOccurrences(tree);
  const ts = new Set<string>();
  const py = new Set<string>();

  for (const info of buildGeneratorInfoList(PLUGIN_ROOT)) {
    const matching = occurrences.filter(
      (occurrence) => occurrence.id === info.id,
    );
    if (matching.length === 0) {
      continue;
    }
    const declaration = await readDeclaration(info.resolvedFactoryPath);
    if (!declaration) {
      continue;
    }
    for (const { metadata } of matching) {
      for (const entry of ownedDependencyEntries(declaration.ts, metadata)) {
        ts.add(entry.name as string);
      }
      for (const entry of ownedDependencyEntries(declaration.py, metadata)) {
        py.add(entry.name as string);
      }
    }
  }

  // The shared constructs CDK packages only reach a CDK workspace, so a
  // Terraform one never owns them however many generators declare them.
  if (workspaceIac(tree) === 'terraform') {
    for (const name of CDK_ONLY_DEPENDENCIES) {
      ts.delete(name);
    }
  }

  return { ts, py };
};

/**
 * A generator's `DEPENDENCIES`, or undefined when it declares none.
 * A generator that fails to load must not fail the upgrade, so its dependencies
 * are treated as unowned and left as they are.
 */
const readDeclaration = async (
  factoryPath: string,
): Promise<DependencyDeclaration | undefined> => {
  try {
    const module = await import(`${factoryPath}.js`);
    return module.DEPENDENCIES;
  } catch {
    return undefined;
  }
};
