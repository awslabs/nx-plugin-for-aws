/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, writeJson } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LATEST_MIGRATIONS_DIR,
  stampMigrationVersions,
} from '../migration-versions';
import { NX_PACKAGES, NX_VERSION } from '../versions';
import {
  nxPackageUpdatesKey,
  type PackageJsonUpdates,
} from './nx-package-updates';
import { registerNxPackageUpdates } from './register';

const PACKAGE_JSON_UPDATES_PATH = 'packages/nx-plugin/packageJsonUpdates.json';
const NX_KEY = nxPackageUpdatesKey(NX_VERSION);

const readUpdates = (tree: Tree): PackageJsonUpdates =>
  JSON.parse(tree.read(PACKAGE_JSON_UPDATES_PATH, 'utf-8'));

describe('registerNxPackageUpdates', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
  });

  it('should declare packageJsonUpdates for every nx package when nx moved', () => {
    const written = registerNxPackageUpdates(tree);

    expect(written).toEqual([PACKAGE_JSON_UPDATES_PATH]);
    const updates = readUpdates(tree);
    // Keyed by the nx version it moves to, so a bump still waiting for a release
    // can't be overwritten by the next one.
    expect(Object.keys(updates)).toEqual([NX_KEY]);
    const packages = updates[NX_KEY]?.packages;
    expect(Object.keys(packages ?? {}).sort()).toEqual([...NX_PACKAGES].sort());
    for (const entry of Object.values(packages ?? {})) {
      expect(entry.version).toBe(NX_VERSION);
    }
  });

  it('should stamp the nx bump with the pending release version', () => {
    registerNxPackageUpdates(tree);

    const stamped = stampMigrationVersions(
      { packageJsonUpdates: readUpdates(tree) },
      {},
      '1.0.0-rc.49',
    );

    // Gated on the version that really ships, under the key it was written with
    // — so a later release's bump sits alongside rather than over it.
    expect(stamped.packageJsonUpdates?.[NX_KEY]).toEqual(
      expect.objectContaining({ version: '1.0.0-rc.49' }),
    );
  });

  it('should be idempotent across repeated runs before a release', () => {
    registerNxPackageUpdates(tree);
    const first = readUpdates(tree);

    registerNxPackageUpdates(tree);

    expect(readUpdates(tree)).toEqual(first);
  });

  // The update script rewrites `versions.ts` on the tree, which cannot change the
  // `NX_VERSION` the process imported at load — so it passes the version it just
  // wrote, or the entry records the one being replaced.
  it('should record the nx version it is given over the imported one', () => {
    registerNxPackageUpdates(tree, '99.0.0');

    const updates = readUpdates(tree);
    expect(Object.keys(updates)).toEqual([nxPackageUpdatesKey('99.0.0')]);
    const packages = updates[nxPackageUpdatesKey('99.0.0')]?.packages;
    for (const entry of Object.values(packages ?? {})) {
      expect(entry.version).toBe('99.0.0');
    }
  });

  // Both would otherwise ship under the same version, leaving which nx a
  // workspace lands on down to the order nx happens to apply them in.
  it('should supersede a bump still waiting for a release', () => {
    writeJson(tree, PACKAGE_JSON_UPDATES_PATH, {
      'nx-22.0.0-nx-packages': {
        version: LATEST_MIGRATIONS_DIR,
        packages: { nx: {} },
      },
    });

    registerNxPackageUpdates(tree);

    expect(Object.keys(readUpdates(tree))).toEqual([NX_KEY]);
  });

  it('should preserve a packageJsonUpdates entry from another release', () => {
    writeJson(tree, PACKAGE_JSON_UPDATES_PATH, {
      'nx-22.0.0-nx-packages': { version: '1.0.0', packages: { nx: {} } },
    });

    registerNxPackageUpdates(tree);

    expect(Object.keys(readUpdates(tree)).sort()).toEqual(
      ['nx-22.0.0-nx-packages', NX_KEY].sort(),
    );
  });
});
