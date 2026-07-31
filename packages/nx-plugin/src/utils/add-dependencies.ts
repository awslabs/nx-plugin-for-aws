/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  joinPathFragments,
  type Tree,
} from '@nx/devkit';
import {
  applicableDependencies,
  type DependencyDeclaration,
  type DependencyMetadata,
} from './declared-dependencies';
import { addDependenciesToPackageJson } from './dependencies';
import {
  addDependenciesToDependencyGroupInPyProjectToml,
  addDependenciesToPyProjectToml,
} from './py';
import { PY_VERSIONS, TS_VERSIONS } from './versions';

/**
 * Add the dependencies a declaration says apply, so the declaration is the only
 * place packages are listed.
 *
 * Pass the very object recorded as the project's metadata: the version sync
 * migration replays the same predicates against it, so what a generator adds and
 * what the migration owns cannot drift.
 */
export interface AddDependenciesOptions {
  /** The metadata the declaration's `when` predicates read. */
  readonly metadata?: DependencyMetadata;
  /** Project whose manifests receive the dependencies; defaults to the root. */
  readonly projectRoot?: string;
}

/**
 * Add every applicable TypeScript dependency from a declaration.
 *
 * Runtime deps land in the project's manifest so `noUndeclaredDependencies`
 * passes; `dev: true` entries go to the root, where shared tooling belongs.
 */
export const addTsDependencies = (
  tree: Tree,
  declaration: DependencyDeclaration,
  { metadata = {}, projectRoot }: AddDependenciesOptions = {},
): GeneratorCallback => {
  const applicable = applicableDependencies(declaration.ts, metadata);
  const manifests = new Map<
    string,
    { runtime: Record<string, string>; dev: Record<string, string> }
  >();
  for (const entry of applicable) {
    // `root: true` is for shared tooling; everything else belongs to the project
    // so `noUndeclaredDependencies` passes.
    const manifestPath =
      entry.root || !projectRoot
        ? 'package.json'
        : joinPathFragments(projectRoot, 'package.json');
    const manifest = manifests.get(manifestPath) ?? { runtime: {}, dev: {} };
    manifest[entry.dev ? 'dev' : 'runtime'][entry.name as string] =
      TS_VERSIONS[entry.name];
    manifests.set(manifestPath, manifest);
  }

  const callbacks = [...manifests].map(([manifestPath, { runtime, dev }]) =>
    addDependenciesToPackageJson(tree, runtime, dev, manifestPath),
  );
  return async () => {
    for (const callback of callbacks) {
      await callback();
    }
  };
};

/**
 * Add every applicable Python dependency from a declaration, routing `group`
 * entries to their pyproject dependency group.
 */
export const addPyDependencies = (
  tree: Tree,
  declaration: DependencyDeclaration,
  projectRoot: string,
  { metadata = {} }: Pick<AddDependenciesOptions, 'metadata'> = {},
): void => {
  const applicable = applicableDependencies(declaration.py, metadata);
  const main = applicable.filter((entry) => !entry.group);
  if (main.length > 0) {
    addDependenciesToPyProjectToml(
      tree,
      projectRoot,
      declaration,
      main.map((entry) => entry.name) as never,
    );
  }

  const groups = new Set(
    applicable.map((entry) => entry.group).filter(Boolean) as string[],
  );
  for (const group of groups) {
    addDependenciesToDependencyGroupInPyProjectToml(
      tree,
      projectRoot,
      group,
      declaration,
      applicable
        .filter((entry) => entry.group === group)
        .map((entry) => entry.name) as never,
    );
  }
};

/** The versions a declaration's applicable Python dependencies pin to. */
export const applicablePyVersions = (
  declaration: DependencyDeclaration,
  metadata: DependencyMetadata = {},
): Record<string, string> =>
  Object.fromEntries(
    applicableDependencies(declaration.py, metadata).map((entry) => [
      entry.name,
      PY_VERSIONS[entry.name],
    ]),
  );
