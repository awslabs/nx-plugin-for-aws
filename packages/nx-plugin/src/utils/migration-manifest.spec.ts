/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  assembleMigrations,
  type DiscoveredMigration,
  MIGRATIONS_JSON_SCHEMA,
  SYNC_VENDED_MIGRATION_KEY,
} from './migration-manifest.js';

const migration = (
  overrides: Partial<DiscoveredMigration> = {},
): DiscoveredMigration => ({
  dir: 'latest',
  name: 'do-a-thing',
  description: 'Do a thing',
  hasImplementation: true,
  hasPrompt: false,
  ...overrides,
});

describe('assembleMigrations', () => {
  it('should always include the version sync entry as everyMigration', () => {
    const { generators } = assembleMigrations('@aws/nx-plugin', []);
    expect(generators?.[SYNC_VENDED_MIGRATION_KEY]).toEqual({
      description:
        'Sync vended dependency versions and the tracked plugin version to those vended by this release',
      implementation: './src/utils/version-upgrade-migration/migration',
      everyMigration: true,
    });
  });

  it('should set the schema and plugin name', () => {
    const manifest = assembleMigrations('@my/plugin', []);
    expect(manifest.$schema).toBe(MIGRATIONS_JSON_SCHEMA);
    expect(manifest.name).toBe('@my/plugin');
  });

  it('should register a deterministic migration under its folder-prefixed key', () => {
    const { generators } = assembleMigrations('@aws/nx-plugin', [migration()]);
    expect(generators?.['latest-do-a-thing']).toEqual({
      description: 'Do a thing',
      implementation: './src/migrations/latest/do-a-thing/migration',
    });
  });

  it('should register an agentic migration with a prompt only', () => {
    const { generators } = assembleMigrations('@aws/nx-plugin', [
      migration({ hasImplementation: false, hasPrompt: true }),
    ]);
    expect(generators?.['latest-do-a-thing']).toEqual({
      description: 'Do a thing',
      prompt: './src/migrations/latest/do-a-thing/prompt.md',
    });
  });

  it('should register a hybrid migration with both fields', () => {
    const { generators } = assembleMigrations('@aws/nx-plugin', [
      migration({ hasImplementation: true, hasPrompt: true }),
    ]);
    expect(generators?.['latest-do-a-thing']).toEqual({
      description: 'Do a thing',
      implementation: './src/migrations/latest/do-a-thing/migration',
      prompt: './src/migrations/latest/do-a-thing/prompt.md',
    });
  });

  it('should derive the version from a v-prefixed release folder', () => {
    const { generators } = assembleMigrations('@aws/nx-plugin', [
      migration({ dir: 'v1.2.3' }),
    ]);
    expect(generators?.['v1.2.3-do-a-thing']).toEqual({
      version: '1.2.3',
      description: 'Do a thing',
      implementation: './src/migrations/v1.2.3/do-a-thing/migration',
    });
  });

  it('should not derive a version for a latest migration', () => {
    const { generators } = assembleMigrations('@aws/nx-plugin', [migration()]);
    expect(generators?.['latest-do-a-thing'].version).toBeUndefined();
  });

  it('should sort generator keys so regeneration is deterministic', () => {
    const { generators } = assembleMigrations('@aws/nx-plugin', [
      migration({ name: 'zebra' }),
      migration({ name: 'alpha' }),
    ]);
    expect(Object.keys(generators ?? {})).toEqual([
      'latest-alpha',
      'latest-zebra',
      SYNC_VENDED_MIGRATION_KEY,
    ]);
  });

  it('should order a release`s migrations by their folder prefix, not their name', () => {
    // Committed bravo-then-alpha, so backfill numbered them 0001/0002 — the
    // prefix, not the name, is what sorts them into commit order.
    const { generators } = assembleMigrations('@aws/nx-plugin', [
      migration({ dir: 'v1.2.3', name: '0002-alpha' }),
      migration({ dir: 'v1.2.3', name: '0001-bravo' }),
    ]);
    const versioned = Object.keys(generators ?? {}).filter((key) =>
      key.startsWith('v1.2.3-'),
    );
    expect(versioned).toEqual(['v1.2.3-0001-bravo', 'v1.2.3-0002-alpha']);
  });

  it('should include packageJsonUpdates only when present', () => {
    expect(
      assembleMigrations('@aws/nx-plugin', []).packageJsonUpdates,
    ).toBeUndefined();
    expect(
      assembleMigrations('@aws/nx-plugin', [], {}).packageJsonUpdates,
    ).toBeUndefined();

    const updates = { 'nx-23.1.0-nx-packages': { version: 'latest' } };
    expect(
      assembleMigrations('@aws/nx-plugin', [], updates).packageJsonUpdates,
    ).toEqual(updates);
  });
});
