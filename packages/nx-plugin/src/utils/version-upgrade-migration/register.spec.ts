/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, type Tree, writeJson } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  LATEST_MIGRATIONS_DIR,
  type MigrationsJson,
  stampMigrationVersions,
} from '../migration-versions';
import { NX_PACKAGES, NX_VERSION } from '../versions';
import { nxPackageUpdatesKey } from './nx-package-updates';
import { registerNxPackageUpdates } from './register';

const MIGRATIONS_JSON_PATH = 'packages/nx-plugin/migrations.json';
const NX_KEY = nxPackageUpdatesKey(NX_VERSION);

const readMigrations = (tree: Tree): MigrationsJson =>
  readJson(tree, MIGRATIONS_JSON_PATH);

describe('registerNxPackageUpdates', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    writeJson(tree, MIGRATIONS_JSON_PATH, {
      $schema: 'http://json-schema.org/schema',
      name: '@aws/nx-plugin',
      generators: {},
    });
  });

  it('should declare packageJsonUpdates for every nx package when nx moved', () => {
    const written = registerNxPackageUpdates(tree);

    expect(written).toEqual([MIGRATIONS_JSON_PATH]);
    const updates = readMigrations(tree).packageJsonUpdates;
    // Keyed by the nx version it moves to, so a bump still waiting for a release
    // can't be overwritten by the next one.
    expect(Object.keys(updates ?? {})).toEqual([NX_KEY]);
    const packages = (
      updates?.[NX_KEY] as
        | { packages?: Record<string, { version: string }> }
        | undefined
    )?.packages;
    expect(Object.keys(packages ?? {}).sort()).toEqual([...NX_PACKAGES].sort());
    for (const entry of Object.values(packages ?? {})) {
      expect(entry.version).toBe(NX_VERSION);
    }
  });

  it('should not register a migration, which is committed as everyMigration', () => {
    registerNxPackageUpdates(tree);

    expect(readMigrations(tree).generators).toEqual({});
  });

  it('should stamp the nx bump with the pending release version', () => {
    registerNxPackageUpdates(tree);

    const stamped = stampMigrationVersions(
      readMigrations(tree),
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
    const first = readMigrations(tree);

    registerNxPackageUpdates(tree);

    expect(readMigrations(tree)).toEqual(first);
  });

  // Both would otherwise ship under the same version, leaving which nx a
  // workspace lands on down to the order nx happens to apply them in.
  it('should supersede a bump still waiting for a release', () => {
    writeJson(tree, MIGRATIONS_JSON_PATH, {
      name: '@aws/nx-plugin',
      generators: {},
      packageJsonUpdates: {
        'nx-22.0.0-nx-packages': {
          version: LATEST_MIGRATIONS_DIR,
          packages: { nx: {} },
        },
      },
    });

    registerNxPackageUpdates(tree);

    expect(Object.keys(readMigrations(tree).packageJsonUpdates ?? {})).toEqual([
      NX_KEY,
    ]);
  });

  it('should preserve a packageJsonUpdates entry from another release', () => {
    writeJson(tree, MIGRATIONS_JSON_PATH, {
      name: '@aws/nx-plugin',
      generators: {},
      packageJsonUpdates: {
        'nx-22.0.0-nx-packages': { version: '1.0.0', packages: { nx: {} } },
      },
    });

    registerNxPackageUpdates(tree);

    expect(
      Object.keys(readMigrations(tree).packageJsonUpdates ?? {}).sort(),
    ).toEqual(['nx-22.0.0-nx-packages', NX_KEY]);
  });
});
