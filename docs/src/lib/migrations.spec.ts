/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { LATEST_MIGRATIONS_DIR } from '../../../packages/nx-plugin/src/utils/migration-versions';
import { discoverMigrations } from '../../../scripts/utils/migration-folders';
import { MIGRATIONS_PATH, readMigrationReleases } from './migrations';

/**
 * The reference page reads the migration tree itself, so these guard that it
 * stays in step with what `migrations.json` is assembled from.
 */
describe('migrations reference', () => {
  const releases = readMigrationReleases();

  it('should list every migration exactly once', () => {
    const listed = releases
      .flatMap((release) => release.migrations.map((m) => m.name))
      .sort();
    const discovered = discoverMigrations(MIGRATIONS_PATH)
      .map((m) => m.name.replace(/^\d{4}-/, ''))
      .sort();
    expect(listed).toEqual(discovered);
  });

  it('should carry the description migrations.json registers', () => {
    const descriptions = new Map(
      discoverMigrations(MIGRATIONS_PATH).map((m) => [
        m.name.replace(/^\d{4}-/, ''),
        m.description,
      ]),
    );
    for (const release of releases) {
      for (const migration of release.migrations) {
        expect(migration.description).toBe(descriptions.get(migration.name));
      }
    }
  });

  it('should order releases newest first, with the unreleased ones ahead', () => {
    expect(releases[0].version).toBeUndefined();
    const versions = releases.slice(1).map((r) => r.version!);
    expect(versions).toEqual([...versions].sort().reverse());
  });

  it('should list each release in the run order its folder names bed in', () => {
    for (const release of releases.filter((r) => r.version)) {
      const orders = release.migrations.map((m) => m.order);
      expect(orders).toEqual([...orders].sort((a, b) => a! - b!));
    }
  });

  it('should discriminate the kind from the files present', () => {
    const kinds = new Map(
      discoverMigrations(MIGRATIONS_PATH).map((m) => [
        m.name.replace(/^\d{4}-/, ''),
        m.hasImplementation && m.hasPrompt
          ? 'hybrid'
          : m.hasPrompt
            ? 'agentic'
            : 'deterministic',
      ]),
    );
    for (const release of releases) {
      for (const migration of release.migrations) {
        expect(migration.kind).toBe(kinds.get(migration.name));
      }
    }
  });

  it('should leave unreleased migrations unordered', () => {
    const unreleased = discoverMigrations(MIGRATIONS_PATH).filter(
      (m) => m.dir === LATEST_MIGRATIONS_DIR,
    );
    expect(releases[0].migrations).toHaveLength(unreleased.length);
    for (const migration of releases[0].migrations) {
      expect(migration.order).toBeUndefined();
    }
  });
});
