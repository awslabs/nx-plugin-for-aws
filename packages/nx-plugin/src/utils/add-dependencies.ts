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
} from './declared-dependencies.js';
import { addDependenciesToPackageJson } from './dependencies.js';
import {
  addDependenciesToDependencyGroupInPyProjectToml,
  addDependenciesToPyProjectToml,
} from './py.js';
import { TS_VERSIONS } from './versions.js';

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
  /**
   * Project whose manifests receive the dependencies. Required unless every
   * applicable entry is marked `root`, which targets the workspace root instead.
   */
  readonly projectRoot?: string;
}

/**
 * The manifest an entry belongs in: the workspace root for shared tooling
 * (`root: true`), otherwise the project's own.
 *
 * A project-level entry with no `projectRoot` is a mistake rather than a default
 * — silently adding it to the root manifest would leave the project failing
 * `noUndeclaredDependencies` on a dependency it imports.
 */
const requireProjectRoot = (
  entry: { name: unknown; root?: boolean },
  projectRoot: string | undefined,
  generator: string,
): string | undefined => {
  if (entry.root) {
    return undefined;
  }
  if (!projectRoot) {
    throw new Error(
      `${generator} was called without a projectRoot, but '${String(entry.name)}' is not declared with \`root: true\`. ` +
        `Pass the project's root, or declare the dependency with \`root: true\` if it belongs to the workspace root.`,
    );
  }
  return projectRoot;
};

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
    const root = requireProjectRoot(entry, projectRoot, 'addTsDependencies');
    const manifestPath = root
      ? joinPathFragments(root, 'package.json')
      : 'package.json';
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
 *
 * `root: true` entries go to the workspace root pyproject, where shared tooling
 * belongs, mirroring the TypeScript side.
 */
export const addPyDependencies = (
  tree: Tree,
  declaration: DependencyDeclaration,
  { metadata = {}, projectRoot }: AddDependenciesOptions = {},
): void => {
  const applicable = applicableDependencies(declaration.py, metadata);

  // Keyed by the pyproject to write and the group within it, since one
  // declaration may span the project's and the workspace root's.
  const buckets = new Map<
    string,
    { root: string; group?: string; names: string[] }
  >();
  for (const entry of applicable) {
    const root =
      requireProjectRoot(entry, projectRoot, 'addPyDependencies') ?? '.';
    const key = `${root}\0${entry.group ?? ''}`;
    const bucket = buckets.get(key) ?? { root, group: entry.group, names: [] };
    bucket.names.push(entry.name as string);
    buckets.set(key, bucket);
  }

  for (const { root, group, names } of buckets.values()) {
    if (group) {
      addDependenciesToDependencyGroupInPyProjectToml(
        tree,
        root,
        group,
        declaration,
        names as never,
      );
    } else {
      addDependenciesToPyProjectToml(tree, root, declaration, names as never);
    }
  }
};
