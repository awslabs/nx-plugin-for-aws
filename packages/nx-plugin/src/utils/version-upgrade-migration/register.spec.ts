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
import { registerSyncVersionsMigration } from './register';

const MIGRATIONS_JSON_PATH = 'packages/nx-plugin/migrations.json';
const KEY = `${LATEST_MIGRATIONS_DIR}-sync-vended-versions`;
const NX_KEY = `${LATEST_MIGRATIONS_DIR}-nx-packages`;

const readMigrations = (tree: Tree): MigrationsJson =>
  readJson(tree, MIGRATIONS_JSON_PATH);

describe('registerSyncVersionsMigration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    writeJson(tree, MIGRATIONS_JSON_PATH, {
      $schema: 'http://json-schema.org/schema',
      name: '@aws/nx-plugin',
      generators: {},
    });
  });

  it('should register the migration without a version', () => {
    const written = registerSyncVersionsMigration(tree, false);

    expect(written).toEqual([MIGRATIONS_JSON_PATH]);
    // The release stamps the version; source never carries one.
    expect(readMigrations(tree).generators?.[KEY].version).toBeUndefined();
  });

  it('should point at the committed migration rather than generating one', () => {
    registerSyncVersionsMigration(tree, false);

    expect(readMigrations(tree).generators?.[KEY].implementation).toBe(
      './src/utils/version-upgrade-migration/migration',
    );
    // No per-release migration file is generated under src/migrations.
    expect(
      tree
        .listChanges()
        .map((change) => change.path)
        .filter((path) => path.includes('/migrations/')),
    ).toEqual([]);
  });

  it('should not declare packageJsonUpdates when no nx package moved', () => {
    registerSyncVersionsMigration(tree, false);

    expect(readMigrations(tree).packageJsonUpdates).toBeUndefined();
  });

  it('should declare packageJsonUpdates for every nx package when nx moved', () => {
    registerSyncVersionsMigration(tree, true);

    const updates = readMigrations(tree).packageJsonUpdates;
    // Keyed like the migrations, so a concurrent PR's entry can't overwrite it.
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

  it('should stamp the migration and nx bump with the pending release version', () => {
    registerSyncVersionsMigration(tree, true);

    const stamped = stampMigrationVersions(
      readMigrations(tree),
      {},
      '1.0.0-rc.49',
    );

    // Both must be gated on the version that really ships, and re-keyed out of
    // `latest` so a later release's entry sits alongside rather than over it.
    expect(stamped.generators?.[KEY].version).toBe('1.0.0-rc.49');
    expect(stamped.packageJsonUpdates?.[NX_KEY]).toBeUndefined();
    expect(stamped.packageJsonUpdates?.['v1.0.0-rc.49-nx-packages']).toEqual(
      expect.objectContaining({ version: '1.0.0-rc.49' }),
    );
  });

  it('should be idempotent across repeated runs before a release', () => {
    registerSyncVersionsMigration(tree, true);
    const first = readMigrations(tree);

    registerSyncVersionsMigration(tree, true);

    // A release only ever ships one set of vended versions, so a second run in
    // the same window refreshes the entry rather than adding another.
    expect(readMigrations(tree)).toEqual(first);
  });

  it('should preserve migrations already registered', () => {
    writeJson(tree, MIGRATIONS_JSON_PATH, {
      name: '@aws/nx-plugin',
      generators: {
        'v1.0.0-some-earlier-migration': {
          version: '1.0.0',
          description: 'earlier',
        },
      },
    });

    registerSyncVersionsMigration(tree, false);

    expect(
      readMigrations(tree).generators?.['v1.0.0-some-earlier-migration'],
    ).toEqual({ version: '1.0.0', description: 'earlier' });
  });

  it('should preserve a packageJsonUpdates entry from another release', () => {
    writeJson(tree, MIGRATIONS_JSON_PATH, {
      name: '@aws/nx-plugin',
      generators: {},
      packageJsonUpdates: {
        'v1.0.0-nx-packages': { version: '1.0.0', packages: { nx: {} } },
      },
    });

    registerSyncVersionsMigration(tree, true);

    expect(
      Object.keys(readMigrations(tree).packageJsonUpdates ?? {}).sort(),
    ).toEqual([NX_KEY, 'v1.0.0-nx-packages']);
  });
});
