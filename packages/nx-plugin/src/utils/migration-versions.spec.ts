/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  backfillMigrationVersions,
  type MigrationsJson,
  orderPrefix,
  readShippedMigrationVersions,
  stampMigrationVersions,
} from './migration-versions';

describe('migration versions', () => {
  describe('readShippedMigrationVersions', () => {
    // Releases newest first, as `readShippedMigrationVersions` expects
    const RELEASES: Record<string, string[]> = {
      '1.2.0': ['v1.0.0-old', 'v1.1.0-middle', 'v1.2.0-newest'],
      '1.1.0': ['v1.0.0-old', 'v1.1.0-middle'],
      '1.0.0': ['v1.0.0-old'],
      '0.9.0': [],
    };
    const VERSIONS = ['1.2.0', '1.1.0', '1.0.0', '0.9.0'];

    const reader = (calls: string[] = []) => {
      const read = (version: string): MigrationsJson | undefined => {
        calls.push(version);
        const keys = RELEASES[version];
        // A release predating migrations.json has no manifest at all
        return keys
          ? { generators: Object.fromEntries(keys.map((key) => [key, {}])) }
          : undefined;
      };
      return { read, calls };
    };

    const unversioned = (keys: string[]): MigrationsJson => ({
      generators: Object.fromEntries(keys.map((key) => [key, {}])),
    });

    it('should resolve the earliest release registering each migration', () => {
      const { read } = reader();
      expect(
        readShippedMigrationVersions(
          unversioned(['v1.0.0-old', 'v1.1.0-middle', 'v1.2.0-newest']),
          VERSIONS,
          read,
        ),
      ).toEqual({
        'v1.0.0-old': '1.0.0',
        'v1.1.0-middle': '1.1.0',
        'v1.2.0-newest': '1.2.0',
      });
    });

    it('should omit a migration that has never shipped', () => {
      const { read } = reader();
      expect(
        readShippedMigrationVersions(
          unversioned(['latest-net-new']),
          VERSIONS,
          read,
        ),
      ).toEqual({});
    });

    it('should skip entries that already have a version', () => {
      const { read, calls } = reader();
      expect(
        readShippedMigrationVersions(
          { generators: { 'v1.0.0-old': { version: '1.0.0' } } },
          VERSIONS,
          read,
        ),
      ).toEqual({});
      // Nothing to resolve, so no release manifests are read
      expect(calls).toEqual([]);
    });

    it('should stop reading releases once every migration is resolved', () => {
      const { read, calls } = reader();
      readShippedMigrationVersions(
        unversioned(['v1.2.0-newest']),
        VERSIONS,
        read,
      );
      // Absent from 1.1.0, so nothing older needs reading
      expect(calls).toEqual(['1.2.0', '1.1.0']);
    });

    it('should treat a release with no manifest as registering nothing', () => {
      const { read } = reader();
      expect(
        readShippedMigrationVersions(
          unversioned(['v1.0.0-old']),
          ['0.9.0'],
          read,
        ),
      ).toEqual({});
    });

    // The nx bumps resolve the same way as the migrations and share the walk, so
    // the release doesn't read tag history twice.
    it('should resolve packageJsonUpdates from the same release walk', () => {
      const read = (version: string): MigrationsJson | undefined =>
        version === '1.2.0'
          ? {
              generators: {},
              packageJsonUpdates: {
                'nx-23.1.1-nx-packages': { version: '1.2.0' },
              },
            }
          : { generators: {} };

      expect(
        readShippedMigrationVersions(
          {
            generators: {},
            packageJsonUpdates: {
              // Released, so datable from history.
              'nx-23.1.1-nx-packages': { version: 'latest' },
              // Never published, so left for the release to stamp.
              'nx-23.2.0-nx-packages': { version: 'latest' },
            },
          },
          VERSIONS,
          read,
        ),
      ).toEqual({ 'nx-23.1.1-nx-packages': '1.2.0' });
    });
  });

  describe('stampMigrationVersions', () => {
    it('should stamp shipped migrations with their first shipped version', () => {
      const stamped = stampMigrationVersions(
        {
          generators: {
            'my-migration': { description: 'shipped' },
          },
        },
        { 'my-migration': '1.1.0' },
        '1.2.0',
      );
      expect(stamped.generators?.['my-migration'].version).toBe('1.1.0');
    });

    it('should stamp unshipped migrations with the pending release version', () => {
      const stamped = stampMigrationVersions(
        { generators: { 'new-migration': { description: 'unshipped' } } },
        {},
        '1.0.0-rc.49',
      );
      expect(stamped.generators?.['new-migration'].version).toBe('1.0.0-rc.49');
    });

    it('should prefer a shipped version over the pending release version', () => {
      const stamped = stampMigrationVersions(
        { generators: { 'my-migration': { description: 'shipped' } } },
        { 'my-migration': '1.1.0' },
        '1.3.0',
      );
      expect(stamped.generators?.['my-migration'].version).toBe('1.1.0');
    });

    it('should preserve all other entry fields', () => {
      const stamped = stampMigrationVersions(
        {
          generators: {
            'my-migration': {
              description: 'a migration',
              implementation: './src/migrations/my-migration/migration',
            },
          },
        },
        {},
        '1.0.0-rc.33',
      );
      expect(stamped.generators?.['my-migration']).toEqual({
        version: '1.0.0-rc.33',
        description: 'a migration',
        implementation: './src/migrations/my-migration/migration',
      });
    });

    it('should re-stamp an every-migration migration with the pending version', () => {
      const stamped = stampMigrationVersions(
        {
          generators: {
            'sync-metrics-version': {
              description: 'runs every release',
              everyMigration: true,
            },
          },
        },
        // Already shipped, and carrying a source version — an every-migration
        // entry must ignore both, or it would never run again.
        { 'sync-metrics-version': '1.1.0' },
        '1.3.0',
      );
      expect(stamped.generators?.['sync-metrics-version'].version).toBe(
        '1.3.0',
      );
    });

    it('should emit every-migration entries last so they run after the rest', () => {
      const stamped = stampMigrationVersions(
        {
          generators: {
            'sync-vended-versions': {
              description: 'runs every migration',
              everyMigration: true,
            },
            'latest-code-change': { description: 'a code migration' },
          },
        },
        {},
        '1.3.0',
      );

      // Every entry carries the pending version here, and `nx migrate` keeps the
      // manifest's order among equal versions — so order is the only lever.
      expect(Object.keys(stamped.generators ?? {})).toEqual([
        'latest-code-change',
        'sync-vended-versions',
      ]);
    });

    it('should order migrations sharing a version by commit rank', () => {
      const stamped = stampMigrationVersions(
        {
          generators: {
            'latest-authored-second': { description: 'second' },
            'latest-authored-first': { description: 'first' },
          },
        },
        {},
        '1.3.0',
        // Keys aren't in commit order — the ranks are what orders them.
        { 'latest-authored-first': 1, 'latest-authored-second': 2 },
      );
      expect(Object.keys(stamped.generators ?? {})).toEqual([
        'latest-authored-first',
        'latest-authored-second',
      ]);
    });

    it('should keep every-migration entries last regardless of commit rank', () => {
      const stamped = stampMigrationVersions(
        {
          generators: {
            'sync-vended-versions': {
              description: 'runs every migration',
              everyMigration: true,
            },
            'latest-code-change': { description: 'a code migration' },
          },
        },
        {},
        '1.3.0',
        // A high rank on the code migration must not float it past the
        // every-migration entry, which carries no rank.
        { 'latest-code-change': 99 },
      );
      expect(Object.keys(stamped.generators ?? {})).toEqual([
        'latest-code-change',
        'sync-vended-versions',
      ]);
    });

    it('should sort ranked migrations ahead of unranked ones', () => {
      const stamped = stampMigrationVersions(
        {
          generators: {
            'latest-unranked': { description: 'no history' },
            'latest-ranked': { description: 'has history' },
          },
        },
        {},
        '1.3.0',
        { 'latest-ranked': 5 },
      );
      expect(Object.keys(stamped.generators ?? {})).toEqual([
        'latest-ranked',
        'latest-unranked',
      ]);
    });

    it('should fall back to manifest key order for equal ranks', () => {
      const stamped = stampMigrationVersions(
        {
          generators: {
            'latest-alpha': { description: 'alpha' },
            'latest-bravo': { description: 'bravo' },
          },
        },
        {},
        '1.3.0',
        // Added in the same commit (squash merge), so the same rank — the stable
        // sort leaves the manifest's key order in place.
        { 'latest-alpha': 3, 'latest-bravo': 3 },
      );
      expect(Object.keys(stamped.generators ?? {})).toEqual([
        'latest-alpha',
        'latest-bravo',
      ]);
    });

    it('should strip the source-only everyMigration flag', () => {
      const stamped = stampMigrationVersions(
        {
          generators: {
            'sync-metrics-version': {
              description: 'runs every release',
              implementation: './x',
              everyMigration: true,
            },
          },
        },
        {},
        '1.3.0',
      );
      expect(stamped.generators?.['sync-metrics-version']).toEqual({
        version: '1.3.0',
        description: 'runs every release',
        implementation: './x',
      });
    });

    it('should keep a version already backfilled into source', () => {
      const stamped = stampMigrationVersions(
        {
          generators: {
            'backfilled-migration': {
              version: '1.0.0-rc.20',
              description: 'backfilled',
            },
          },
        },
        // Tag history would resolve a different version; source wins.
        { 'backfilled-migration': '1.0.0-rc.21' },
        '1.0.0-rc.44',
      );
      expect(stamped.generators?.['backfilled-migration'].version).toBe(
        '1.0.0-rc.20',
      );
    });
  });

  describe('backfillMigrationVersions', () => {
    it('should record the release that shipped a migration', () => {
      const { migrations, backfilled } = backfillMigrationVersions(
        { generators: { 'latest-shipped': { description: 'shipped' } } },
        { 'latest-shipped': '1.1.0' },
      );
      expect(migrations.generators?.['v1.1.0-0001-shipped'].version).toBe(
        '1.1.0',
      );
      expect(backfilled).toEqual(['latest-shipped']);
    });

    it('should move a released migration out of latest into its order-prefixed version folder', () => {
      const { migrations, moves } = backfillMigrationVersions(
        {
          generators: {
            'latest-shipped': {
              description: 'shipped',
              implementation: './src/migrations/latest/shipped/migration',
              prompt: './src/migrations/latest/shipped/prompt.md',
            },
          },
        },
        { 'latest-shipped': '1.1.0' },
      );
      expect(migrations.generators).toEqual({
        'v1.1.0-0001-shipped': {
          version: '1.1.0',
          description: 'shipped',
          implementation: './src/migrations/v1.1.0/0001-shipped/migration',
          prompt: './src/migrations/v1.1.0/0001-shipped/prompt.md',
        },
      });
      expect(moves).toEqual([
        {
          name: 'shipped',
          version: '1.1.0',
          from: 'src/migrations/latest/shipped',
          to: 'src/migrations/v1.1.0/0001-shipped',
        },
      ]);
    });

    it('should order a release`s migrations by commit rank in their folder prefix', () => {
      const { migrations, moves } = backfillMigrationVersions(
        {
          generators: {
            // Keyed alphabetically, but committed in the reverse order.
            'latest-alpha': {
              description: 'alpha, committed last',
              implementation: './src/migrations/latest/alpha/migration',
            },
            'latest-bravo': {
              description: 'bravo, committed first',
              implementation: './src/migrations/latest/bravo/migration',
            },
          },
        },
        { 'latest-alpha': '2.0.0', 'latest-bravo': '2.0.0' },
        { 'latest-bravo': 1, 'latest-alpha': 2 },
      );
      expect(migrations.generators?.['v2.0.0-0001-bravo']).toBeDefined();
      expect(migrations.generators?.['v2.0.0-0002-alpha']).toBeDefined();
      expect(moves).toEqual(
        expect.arrayContaining([
          {
            name: 'bravo',
            version: '2.0.0',
            from: 'src/migrations/latest/bravo',
            to: 'src/migrations/v2.0.0/0001-bravo',
          },
          {
            name: 'alpha',
            version: '2.0.0',
            from: 'src/migrations/latest/alpha',
            to: 'src/migrations/v2.0.0/0002-alpha',
          },
        ]),
      );
    });

    it('should fall back to alphabetical order for migrations sharing a commit', () => {
      const { migrations } = backfillMigrationVersions(
        {
          generators: {
            'latest-bravo': { description: 'bravo' },
            'latest-alpha': { description: 'alpha' },
          },
        },
        { 'latest-alpha': '2.0.0', 'latest-bravo': '2.0.0' },
        // Same commit rank — the tiebreak is the migration name.
        { 'latest-alpha': 7, 'latest-bravo': 7 },
      );
      expect(migrations.generators?.['v2.0.0-0001-alpha']).toBeDefined();
      expect(migrations.generators?.['v2.0.0-0002-bravo']).toBeDefined();
    });

    it('should number each release independently', () => {
      const { migrations } = backfillMigrationVersions(
        {
          generators: {
            'latest-first': { description: 'first release' },
            'latest-second': { description: 'second release' },
          },
        },
        { 'latest-first': '1.1.0', 'latest-second': '1.2.0' },
        { 'latest-first': 1, 'latest-second': 2 },
      );
      expect(migrations.generators?.['v1.1.0-0001-first']).toBeDefined();
      expect(migrations.generators?.['v1.2.0-0001-second']).toBeDefined();
    });

    it('should keep migrations of the same name shipped by different releases', () => {
      const { migrations } = backfillMigrationVersions(
        {
          generators: {
            'v1.1.0-0001-rename-target': {
              version: '1.1.0',
              description: 'first time round',
              implementation:
                './src/migrations/v1.1.0/0001-rename-target/migration',
            },
            'latest-rename-target': {
              description: 'again, for a later rename',
              implementation: './src/migrations/latest/rename-target/migration',
            },
          },
        },
        { 'latest-rename-target': '2.0.0' },
      );
      expect(Object.keys(migrations.generators ?? {})).toEqual([
        'v1.1.0-0001-rename-target',
        'v2.0.0-0001-rename-target',
      ]);
      expect(
        migrations.generators?.['v1.1.0-0001-rename-target'].description,
      ).toBe('first time round');
      expect(migrations.generators?.['v2.0.0-0001-rename-target']).toEqual({
        version: '2.0.0',
        description: 'again, for a later rename',
        implementation: './src/migrations/v2.0.0/0001-rename-target/migration',
      });
    });

    it('should not move an unreleased migration out of latest', () => {
      const { migrations, moves } = backfillMigrationVersions(
        {
          generators: {
            'latest-net-new': {
              description: 'not released yet',
              implementation: './src/migrations/latest/net-new/migration',
            },
          },
        },
        {},
      );
      expect(migrations.generators?.['latest-net-new'].implementation).toBe(
        './src/migrations/latest/net-new/migration',
      );
      expect(moves).toEqual([]);
    });

    it('should leave an unreleased migration without a version', () => {
      const { migrations, backfilled } = backfillMigrationVersions(
        {
          generators: { 'latest-net-new': { description: 'not released yet' } },
        },
        {},
      );
      expect(migrations.generators?.['latest-net-new'].version).toBeUndefined();
      expect(backfilled).toEqual([]);
    });

    // Dated in place: the key already names what the bump targets, so it stays
    // put and a bump still waiting for a release can't be written over.
    it('should date a released packageJsonUpdates entry without re-keying it', () => {
      const { migrations, backfilled } = backfillMigrationVersions(
        {
          generators: { 'latest-shipped': { description: 'shipped' } },
          packageJsonUpdates: {
            'nx-23.1.0-nx-packages': {
              version: 'latest',
              packages: { nx: {} },
            },
          },
        },
        {
          'latest-shipped': '1.1.0',
          'nx-23.1.0-nx-packages': '1.1.0',
        },
      );

      expect(migrations.packageJsonUpdates).toEqual({
        'nx-23.1.0-nx-packages': { version: '1.1.0', packages: { nx: {} } },
      });
      // Reported, so the weekly PR says the bump was dated.
      expect(backfilled).toContain('nx-23.1.0-nx-packages');
    });

    it('should leave packageJsonUpdates under latest until a release ships it', () => {
      const { migrations } = backfillMigrationVersions(
        {
          generators: { 'latest-net-new': { description: 'not released yet' } },
          packageJsonUpdates: {
            'latest-nx-packages': { version: 'latest', packages: { nx: {} } },
          },
        },
        {},
      );
      expect(migrations.packageJsonUpdates).toEqual({
        'latest-nx-packages': { version: 'latest', packages: { nx: {} } },
      });
    });

    it('should never claim an every-migration migration for a release', () => {
      const { migrations, backfilled, moves } = backfillMigrationVersions(
        {
          generators: {
            'sync-metrics-version': {
              description: 'runs every release',
              implementation: './src/utils/version-upgrade-migration/migration',
              everyMigration: true,
            },
          },
        },
        // Shipped in an earlier release, but pinning it and moving it out of
        // latest would stop it running on later upgrades.
        { 'sync-metrics-version': '1.1.0' },
      );
      expect(migrations.generators?.['sync-metrics-version']).toEqual({
        description: 'runs every release',
        implementation: './src/utils/version-upgrade-migration/migration',
        everyMigration: true,
      });
      expect(backfilled).toEqual([]);
      expect(moves).toEqual([]);
    });

    it('should not change a migration that already has a version', () => {
      const { migrations, backfilled } = backfillMigrationVersions(
        {
          generators: {
            'v1.0.0-already-recorded': {
              version: '1.0.0',
              description: 'recorded',
            },
          },
        },
        { 'v1.0.0-already-recorded': '1.1.0' },
      );
      expect(migrations.generators?.['v1.0.0-already-recorded'].version).toBe(
        '1.0.0',
      );
      expect(backfilled).toEqual([]);
    });

    it('should backfill only the released, unversioned entries in a mixed collection', () => {
      const { migrations, backfilled } = backfillMigrationVersions(
        {
          generators: {
            'v1.0.0-recorded': { version: '1.0.0', description: 'recorded' },
            'latest-shipped': { description: 'shipped but not recorded' },
            'latest-net-new': { description: 'not released yet' },
          },
        },
        { 'v1.0.0-recorded': '1.0.0', 'latest-shipped': '1.1.0' },
      );
      expect(migrations.generators?.['v1.0.0-recorded'].version).toBe('1.0.0');
      expect(migrations.generators?.['v1.1.0-0001-shipped'].version).toBe(
        '1.1.0',
      );
      expect(migrations.generators?.['latest-net-new'].version).toBeUndefined();
      expect(backfilled).toEqual(['latest-shipped']);
    });

    it('should preserve all other entry fields and top-level keys', () => {
      const { migrations } = backfillMigrationVersions(
        {
          $schema: 'http://json-schema.org/schema',
          name: '@aws/nx-plugin',
          generators: {
            'latest-my-migration': {
              description: 'a migration',
              implementation: './src/migrations/latest/my-migration/migration',
            },
          },
        } as never,
        { 'latest-my-migration': '1.2.3' },
      );
      expect(migrations).toMatchObject({
        $schema: 'http://json-schema.org/schema',
        name: '@aws/nx-plugin',
      });
      expect(migrations.generators?.['v1.2.3-0001-my-migration']).toEqual({
        version: '1.2.3',
        description: 'a migration',
        implementation: './src/migrations/v1.2.3/0001-my-migration/migration',
      });
    });

    it('should be idempotent', () => {
      const shipped = { 'latest-shipped': '1.1.0' };
      const first = backfillMigrationVersions(
        {
          generators: {
            'latest-shipped': {
              description: 'shipped',
              implementation: './src/migrations/latest/shipped/migration',
            },
          },
        },
        shipped,
      );
      const second = backfillMigrationVersions(first.migrations, shipped);
      expect(second.migrations).toEqual(first.migrations);
      expect(second.backfilled).toEqual([]);
      expect(second.moves).toEqual([]);
    });
  });

  describe('orderPrefix', () => {
    it('should zero-pad to a fixed width so prefixes sort lexically', () => {
      expect(orderPrefix(1)).toBe('0001');
      expect(orderPrefix(12)).toBe('0012');
      expect([orderPrefix(2), orderPrefix(10)].sort()).toEqual([
        '0002',
        '0010',
      ]);
    });
  });
});
