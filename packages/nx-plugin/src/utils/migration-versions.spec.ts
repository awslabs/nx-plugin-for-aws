/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { stampMigrationVersions } from './migration-versions';

describe('migration versions', () => {
  describe('stampMigrationVersions', () => {
    it('should stamp unversioned migrations with the release version', () => {
      const { migrations, stamped } = stampMigrationVersions(
        {
          generators: {
            'new-migration': { description: 'unversioned' },
          },
        },
        '1.2.0',
      );
      expect(migrations.generators?.['new-migration'].version).toBe('1.2.0');
      expect(stamped).toEqual(['new-migration']);
    });

    it('should leave migrations that already have a version untouched', () => {
      const { migrations, stamped } = stampMigrationVersions(
        {
          generators: {
            'shipped-migration': { version: '1.1.0', description: 'shipped' },
          },
        },
        '1.2.0',
      );
      expect(migrations.generators?.['shipped-migration'].version).toBe(
        '1.1.0',
      );
      expect(stamped).toEqual([]);
    });

    it('should stamp only the unversioned entries in a mixed collection', () => {
      const { migrations, stamped } = stampMigrationVersions(
        {
          generators: {
            shipped: { version: '1.1.0', description: 'shipped' },
            unshipped: { description: 'unshipped' },
          },
        },
        '1.2.0',
      );
      expect(migrations.generators?.shipped.version).toBe('1.1.0');
      expect(migrations.generators?.unshipped.version).toBe('1.2.0');
      expect(stamped).toEqual(['unshipped']);
    });

    it('should preserve all other entry fields', () => {
      const { migrations } = stampMigrationVersions(
        {
          generators: {
            'my-migration': {
              description: 'a migration',
              implementation: './src/migrations/my-migration/migration',
            },
          },
        },
        '1.0.0-rc.45',
      );
      expect(migrations.generators?.['my-migration']).toEqual({
        version: '1.0.0-rc.45',
        description: 'a migration',
        implementation: './src/migrations/my-migration/migration',
      });
    });

    it('should preserve other top-level keys', () => {
      const { migrations } = stampMigrationVersions(
        {
          $schema: 'http://json-schema.org/schema',
          name: '@aws/nx-plugin',
          generators: { 'my-migration': { description: 'a migration' } },
        } as never,
        '1.2.0',
      );
      expect(migrations).toMatchObject({
        $schema: 'http://json-schema.org/schema',
        name: '@aws/nx-plugin',
      });
    });

    it('should handle an empty collection', () => {
      const { migrations, stamped } = stampMigrationVersions(
        { generators: {} },
        '1.2.0',
      );
      expect(migrations.generators).toEqual({});
      expect(stamped).toEqual([]);
    });
  });
});
