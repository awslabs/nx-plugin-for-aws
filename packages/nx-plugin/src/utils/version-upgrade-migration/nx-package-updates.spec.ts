/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  backfillMigrationVersions,
  LATEST_MIGRATIONS_DIR,
  stampMigrationVersions,
} from '../migration-versions';
import { NX_PACKAGES, NX_VERSION } from '../versions';
import { isNxPackage, nxPackageJsonUpdates } from './nx-package-updates';

describe('nx package updates', () => {
  describe('isNxPackage', () => {
    it('should identify the nx packages moved in lockstep', () => {
      for (const name of NX_PACKAGES) {
        expect(isNxPackage(name)).toBe(true);
      }
    });

    it('should not identify other vended dependencies', () => {
      // `@nx-extend/terraform` and `@nxlv/python` are third-party plugins on
      // their own release cadence, not part of the nx lockstep set.
      for (const name of ['zod', '@nx-extend/terraform', '@nxlv/python']) {
        expect(isNxPackage(name)).toBe(false);
      }
    });
  });

  describe('nxPackageJsonUpdates', () => {
    it('should bump every nx package to the vended version', () => {
      const updates = nxPackageJsonUpdates('latest', '1.2.3');
      const [key] = Object.keys(updates);

      // Keyed by directory, since the entry is written before a version exists
      // and re-keyed to `v<version>` once a release claims it.
      expect(key).toBe('latest-nx-packages');
      expect(updates[key].version).toBe('1.2.3');
      expect(Object.keys(updates[key].packages).sort()).toEqual(
        [...NX_PACKAGES].sort(),
      );
      for (const entry of Object.values(updates[key].packages)) {
        expect(entry.version).toBe(NX_VERSION);
      }
    });

    it('should not collide with an entry from another release', () => {
      const merged = {
        ...nxPackageJsonUpdates('v1.1.0', '1.1.0'),
        ...nxPackageJsonUpdates('latest', '1.2.3'),
      };
      expect(Object.keys(merged).sort()).toEqual([
        'latest-nx-packages',
        'v1.1.0-nx-packages',
      ]);
    });

    // Each release's bump stays behind as the next is written, so a workspace
    // several releases behind gets each nx hop rather than only the newest.
    it('should keep every release its bump shipped in', () => {
      const source = {
        generators: {
          'latest-fix-a': {
            implementation: './src/migrations/latest/fix-a/migration',
          },
        },
        packageJsonUpdates: nxPackageJsonUpdates(
          LATEST_MIGRATIONS_DIR,
          LATEST_MIGRATIONS_DIR,
        ),
      };

      // The weekly backfill re-keys the entry with the release that shipped it.
      const backfilled = backfillMigrationVersions(source, {
        'latest-fix-a': '1.1.0',
      }).migrations;

      // A later release bumps nx again, writing `latest` afresh alongside it.
      const next = {
        ...backfilled,
        packageJsonUpdates: {
          ...backfilled.packageJsonUpdates,
          ...nxPackageJsonUpdates(LATEST_MIGRATIONS_DIR, LATEST_MIGRATIONS_DIR),
        },
      };

      const published = stampMigrationVersions(next, {}, '1.2.0');

      expect(
        Object.entries(published.packageJsonUpdates ?? {}).map(
          ([key, entry]) => [key, entry.version],
        ),
      ).toEqual([
        ['v1.1.0-nx-packages', '1.1.0'],
        ['v1.2.0-nx-packages', '1.2.0'],
      ]);
    });

    it('should not add nx packages a workspace does not already pin', () => {
      // A workspace without e.g. @nx/react must not gain it as a dependency.
      const updates = nxPackageJsonUpdates('latest', '1.2.3');
      for (const { packages } of Object.values(updates)) {
        for (const entry of Object.values(packages)) {
          expect(entry.alwaysAddToPackageJson).toBe(false);
        }
      }
    });

    it('should accept an explicit nx version', () => {
      const updates = nxPackageJsonUpdates('latest', '1.2.3', '24.0.0');
      for (const { packages } of Object.values(updates)) {
        for (const entry of Object.values(packages)) {
          expect(entry.version).toBe('24.0.0');
        }
      }
    });
  });
});
