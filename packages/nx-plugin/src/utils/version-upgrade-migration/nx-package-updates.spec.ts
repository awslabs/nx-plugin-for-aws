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
import {
  isNxPackage,
  nxPackageJsonUpdates,
  nxPackageUpdatesKey,
  type PackageJsonUpdates,
} from './nx-package-updates';

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
      const updates = nxPackageJsonUpdates(LATEST_MIGRATIONS_DIR);
      const [key] = Object.keys(updates);

      // Keyed by the nx version it moves to, which is known when the entry is
      // written — unlike the plugin version, which only a release can supply.
      expect(key).toBe(nxPackageUpdatesKey(NX_VERSION));
      expect(updates[key].version).toBe(LATEST_MIGRATIONS_DIR);
      expect(Object.keys(updates[key].packages).sort()).toEqual(
        [...NX_PACKAGES].sort(),
      );
      for (const entry of Object.values(updates[key].packages)) {
        expect(entry.version).toBe(NX_VERSION);
      }
    });

    // Two bumps can be pending at once — a second update lands before the
    // release that would ship the first — so the key cannot depend on a plugin
    // version neither of them has yet.
    it('should not collide with a bump still waiting for a release', () => {
      const merged = {
        ...nxPackageJsonUpdates(LATEST_MIGRATIONS_DIR, '23.1.0'),
        ...nxPackageJsonUpdates(LATEST_MIGRATIONS_DIR, '23.1.1'),
      };

      expect(Object.keys(merged).sort()).toEqual([
        'nx-23.1.0-nx-packages',
        'nx-23.1.1-nx-packages',
      ]);
    });

    // Each release's bump stays behind as the next is written, so a workspace
    // several releases behind gets each nx hop rather than only the newest.
    it('should keep every release its bump shipped in', () => {
      // An update bumps nx, and the release that ships it is tagged 1.1.0.
      const source = {
        generators: {
          'latest-fix-a': {
            implementation: './src/migrations/latest/fix-a/migration',
          },
        },
        packageJsonUpdates: nxPackageJsonUpdates(
          LATEST_MIGRATIONS_DIR,
          '23.1.0',
        ),
      };

      // The next weekly backfill dates it from the release that published it.
      const backfilled = backfillMigrationVersions(source, {
        'latest-fix-a': '1.1.0',
        [nxPackageUpdatesKey('23.1.0')]: '1.1.0',
      }).migrations;

      // That update also bumps nx again, writing a second pending entry.
      const next = {
        ...backfilled,
        packageJsonUpdates: {
          ...backfilled.packageJsonUpdates,
          ...nxPackageJsonUpdates(LATEST_MIGRATIONS_DIR, '23.1.1'),
        },
      };

      const published = stampMigrationVersions(next, {}, '1.2.0');

      // Both hops survive: 1.1.0 gets a workspace to nx 23.1.0, 1.2.0 to 23.1.1.
      expect(
        Object.entries(
          (published.packageJsonUpdates ?? {}) as PackageJsonUpdates,
        ).map(([key, entry]) => [
          key,
          entry.version,
          entry.packages.nx.version,
        ]),
      ).toEqual([
        [nxPackageUpdatesKey('23.1.0'), '1.1.0', '23.1.0'],
        [nxPackageUpdatesKey('23.1.1'), '1.2.0', '23.1.1'],
      ]);
    });

    it('should not add nx packages a workspace does not already pin', () => {
      // A workspace without e.g. @nx/react must not gain it as a dependency.
      const updates = nxPackageJsonUpdates(LATEST_MIGRATIONS_DIR);
      for (const { packages } of Object.values(updates)) {
        for (const entry of Object.values(packages)) {
          expect(entry.alwaysAddToPackageJson).toBe(false);
        }
      }
    });

    it('should accept an explicit nx version', () => {
      const updates = nxPackageJsonUpdates(LATEST_MIGRATIONS_DIR, '24.0.0');
      for (const { packages } of Object.values(updates)) {
        for (const entry of Object.values(packages)) {
          expect(entry.version).toBe('24.0.0');
        }
      }
    });
  });
});
