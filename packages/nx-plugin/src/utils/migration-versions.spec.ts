/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  backfillMigrationVersions,
  compareVersions,
  stampMigrationVersions,
  unshippedMigrationVersion,
} from './migration-versions';

describe('migration versions', () => {
  describe('unshippedMigrationVersion', () => {
    it('should sit strictly between a release and any possible next release', () => {
      const version = unshippedMigrationVersion('1.2.3');
      expect(compareVersions(version, '1.2.3')).toBeGreaterThan(0);
      expect(compareVersions(version, '1.2.4')).toBeLessThan(0);
      expect(compareVersions(version, '1.3.0')).toBeLessThan(0);
      expect(compareVersions(version, '2.0.0')).toBeLessThan(0);
    });

    it('should sit strictly between a prerelease and the next release', () => {
      const version = unshippedMigrationVersion('1.0.0-rc.32');
      expect(compareVersions(version, '1.0.0-rc.32')).toBeGreaterThan(0);
      expect(compareVersions(version, '1.0.0')).toBeLessThan(0);
    });

    it('should throw on an invalid version', () => {
      expect(() => unshippedMigrationVersion('not-a-version')).toThrow();
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

    it('should stamp unshipped migrations with a version above the latest release', () => {
      const stamped = stampMigrationVersions(
        {
          generators: {
            'new-migration': { description: 'unshipped' },
          },
        },
        {},
        '1.2.0',
      );
      const version = stamped.generators?.['new-migration'].version as string;
      expect(compareVersions(version, '1.2.0')).toBeGreaterThan(0);
      expect(compareVersions(version, '1.2.1')).toBeLessThan(0);
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
        '1.0.0-rc.32',
      );
      expect(stamped.generators?.['my-migration']).toEqual({
        version: '1.0.0-rc.33',
        description: 'a migration',
        implementation: './src/migrations/my-migration/migration',
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
        { generators: { shipped: { description: 'shipped' } } },
        { shipped: '1.1.0' },
      );
      expect(migrations.generators?.shipped.version).toBe('1.1.0');
      expect(backfilled).toEqual(['shipped']);
    });

    it('should leave an unreleased migration without a version', () => {
      const { migrations, backfilled } = backfillMigrationVersions(
        { generators: { 'net-new': { description: 'not released yet' } } },
        {},
      );
      expect(migrations.generators?.['net-new'].version).toBeUndefined();
      expect(backfilled).toEqual([]);
    });

    it('should not change a migration that already has a version', () => {
      const { migrations, backfilled } = backfillMigrationVersions(
        {
          generators: {
            'already-recorded': { version: '1.0.0', description: 'recorded' },
          },
        },
        { 'already-recorded': '1.1.0' },
      );
      expect(migrations.generators?.['already-recorded'].version).toBe('1.0.0');
      expect(backfilled).toEqual([]);
    });

    it('should backfill only the released, unversioned entries in a mixed collection', () => {
      const { migrations, backfilled } = backfillMigrationVersions(
        {
          generators: {
            recorded: { version: '1.0.0', description: 'recorded' },
            shipped: { description: 'shipped but not recorded' },
            'net-new': { description: 'not released yet' },
          },
        },
        { recorded: '1.0.0', shipped: '1.1.0' },
      );
      expect(migrations.generators?.recorded.version).toBe('1.0.0');
      expect(migrations.generators?.shipped.version).toBe('1.1.0');
      expect(migrations.generators?.['net-new'].version).toBeUndefined();
      expect(backfilled).toEqual(['shipped']);
    });

    it('should preserve all other entry fields and top-level keys', () => {
      const { migrations } = backfillMigrationVersions(
        {
          $schema: 'http://json-schema.org/schema',
          name: '@aws/nx-plugin',
          generators: {
            'my-migration': {
              description: 'a migration',
              implementation: './src/migrations/my-migration/migration',
            },
          },
        } as never,
        { 'my-migration': '1.2.3' },
      );
      expect(migrations).toMatchObject({
        $schema: 'http://json-schema.org/schema',
        name: '@aws/nx-plugin',
      });
      expect(migrations.generators?.['my-migration']).toEqual({
        version: '1.2.3',
        description: 'a migration',
        implementation: './src/migrations/my-migration/migration',
      });
    });

    it('should be idempotent', () => {
      const shipped = { shipped: '1.1.0' };
      const first = backfillMigrationVersions(
        { generators: { shipped: { description: 'shipped' } } },
        shipped,
      );
      const second = backfillMigrationVersions(first.migrations, shipped);
      expect(second.migrations).toEqual(first.migrations);
      expect(second.backfilled).toEqual([]);
    });
  });
});
