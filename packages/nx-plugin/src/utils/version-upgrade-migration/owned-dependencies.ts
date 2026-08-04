/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as path from 'node:path';
import { getProjects, type Tree } from '@nx/devkit';
import { AWS_NX_PLUGIN_CONFIG_FILE_NAME } from '../config/utils';
import {
  type DependencyDeclaration,
  type DependencyMetadata,
  ownedDependencyEntries,
} from '../declared-dependencies';
import { buildGeneratorInfoList } from '../generators';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants';

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
  /**
   * The same, split by the root of the project that owns it, for scoping a pin
   * embedded in a generated file to the project it sits in. Keyed by project
   * root; read through {@link ownedForFile}.
   */
  readonly byProject: ReadonlyMap<
    string,
    { readonly ts: ReadonlySet<string>; readonly py: ReadonlySet<string> }
  >;
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
  /** Root of the project this ran against, for scoping what it owns to it. */
  readonly projectRoot?: string;
}

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
      occurrences.push({
        id: metadata.generator,
        metadata: ownMetadata,
        projectRoot: project.root,
      });
    }
    for (const component of metadata?.components ?? []) {
      if (component.generator) {
        occurrences.push({
          id: component.generator,
          metadata: component,
          projectRoot: project.root,
        });
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
  const byProject = new Map<string, { ts: Set<string>; py: Set<string> }>();

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
    for (const { metadata, projectRoot } of matching) {
      const scoped = projectRoot
        ? (byProject.get(projectRoot) ??
          byProject
            .set(projectRoot, { ts: new Set(), py: new Set() })
            .get(projectRoot)!)
        : undefined;
      for (const entry of ownedDependencyEntries(declaration.ts, metadata)) {
        ts.add(entry.name as string);
        scoped?.ts.add(entry.name as string);
      }
      for (const entry of ownedDependencyEntries(declaration.py, metadata)) {
        py.add(entry.name as string);
        scoped?.py.add(entry.name as string);
      }
    }
  }

  return { ts, py, byProject };
};

/**
 * Roots of the projects every generator contributes into, rather than one
 * generator owning outright.
 *
 * `sharedConstructsGenerator` creates these and each infra generator writes its
 * own module into them — the Terraform modules carrying the `uv run --with` pins
 * come from the agent-core, api, identity and website helpers alike. Both are
 * registered projects, so scoping a file here to the generator that created the
 * project would strand every pin the others put there.
 */
const SHARED_PROJECT_ROOTS = [
  `${PACKAGES_DIR}/${SHARED_CONSTRUCTS_DIR}`,
  `${PACKAGES_DIR}/${SHARED_TERRAFORM_DIR}`,
];

/**
 * The dependencies owned where a file sits: those of the project it belongs to,
 * or the workspace-wide union for a file in a shared project or under none.
 *
 * Used for the pins embedded in a generated file, so a version is only rewritten
 * where the generator that pins it actually ran: a `Dockerfile` under one
 * project's root is not upgraded because a sibling project owns the package.
 *
 * The longest matching root wins, since a nested project's root is a prefix of
 * nothing else but its own files.
 */
export const ownedForFile = (
  owned: OwnedDependencies,
  filePath: string,
): { ts: ReadonlySet<string>; py: ReadonlySet<string> } => {
  if (
    SHARED_PROJECT_ROOTS.some(
      (root) => filePath === root || filePath.startsWith(`${root}/`),
    )
  ) {
    return owned;
  }
  let best: { ts: ReadonlySet<string>; py: ReadonlySet<string> } | undefined;
  let bestLength = -1;
  for (const [root, scoped] of owned.byProject) {
    if (
      (filePath === root || filePath.startsWith(`${root}/`)) &&
      root.length > bestLength
    ) {
      best = scoped;
      bestLength = root.length;
    }
  }
  return best ?? owned;
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
