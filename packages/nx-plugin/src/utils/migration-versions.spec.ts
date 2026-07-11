/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
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
  });
});
