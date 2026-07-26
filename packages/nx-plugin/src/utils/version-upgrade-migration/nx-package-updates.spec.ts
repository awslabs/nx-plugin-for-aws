/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
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

      // Keyed like the migration entries, not by version, so a concurrent PR's
      // entry can't collide with this one while both sit in `latest`.
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
