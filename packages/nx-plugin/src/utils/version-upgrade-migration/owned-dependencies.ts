/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as path from 'node:path';
import { getProjects, type Tree } from '@nx/devkit';
import { AWS_NX_PLUGIN_CONFIG_FILE_NAME } from '../config/utils';
import type { DependencyDeclaration } from '../declared-dependencies';
import { buildGeneratorInfoList } from '../generators';

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
 * Generator ids this workspace has run, from the metadata generators record on
 * the projects (and their components) they create.
 *
 * `init` creates no project, so its config file stands in for it.
 */
export const generatorsRun = (tree: Tree): ReadonlySet<string> => {
  const ids = new Set<string>();
  if (tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)) {
    ids.add('init');
  }
  for (const [, project] of getProjects(tree)) {
    const metadata = project.metadata as
      | { generator?: string; components?: { generator?: string }[] }
      | undefined;
    if (metadata?.generator) {
      ids.add(metadata.generator);
    }
    for (const component of metadata?.components ?? []) {
      if (component.generator) {
        ids.add(component.generator);
      }
    }
  }
  return ids;
};

/**
 * Union of the dependencies declared by the generators this workspace has run.
 *
 * Each generator module exports its declaration, so reading one is an import
 * rather than a run — the generators themselves are never invoked.
 */
export const ownedDependencies = async (
  tree: Tree,
): Promise<OwnedDependencies> => {
  const run = generatorsRun(tree);
  const ts = new Set<string>();
  const py = new Set<string>();

  for (const info of buildGeneratorInfoList(PLUGIN_ROOT)) {
    if (!run.has(info.id)) {
      continue;
    }
    const declaration = await readDeclaration(info.resolvedFactoryPath);
    for (const dep of declaration?.ts ?? []) {
      ts.add(dep);
    }
    for (const dep of declaration?.py ?? []) {
      py.add(dep);
    }
  }

  return { ts, py };
};

/**
 * A generator's `DECLARED_DEPENDENCIES`, or undefined when it declares none.
 * A generator that fails to load must not fail the upgrade, so its dependencies
 * are treated as unowned and left as they are.
 */
const readDeclaration = async (
  factoryPath: string,
): Promise<DependencyDeclaration | undefined> => {
  try {
    const module = await import(`${factoryPath}.js`);
    return module.DECLARED_DEPENDENCIES;
  } catch {
    return undefined;
  }
};
