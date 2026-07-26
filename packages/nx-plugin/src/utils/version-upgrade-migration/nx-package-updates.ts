/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { migrationKey } from '../migration-versions';
import { NX_PACKAGES, NX_VERSION } from '../versions';

/**
 * `packageJsonUpdates` for the nx packages a generated workspace pins.
 *
 * A migration cannot bump these: `nx migrate` builds its migration list from the
 * packages it is itself bumping, so an nx version only rewritten by our migration
 * silently skips Nx's own migrations for that hop. Declaring the bump here pulls
 * them in.
 *
 * It also keeps every nx pin moving together. A workspace nx even a patch apart
 * from the plugin's `@nx/*` packages hoists a second nested nx, and the two
 * deadlock `nx sync`.
 */

export const NX_PACKAGE_UPDATES_NAME = 'nx-packages';

export const isNxPackage = (name: string): boolean =>
  (NX_PACKAGES as readonly string[]).includes(name);

/** Indexed to satisfy the open shape `migrations.json` entries carry. */
export interface PackageJsonUpdate extends Record<string, unknown> {
  version: string;
  packages: Record<string, { version: string; alwaysAddToPackageJson: false }>;
}

export type PackageJsonUpdates = Record<string, PackageJsonUpdate>;

/**
 * `alwaysAddToPackageJson: false` so only packages already present are updated.
 * Keyed `<dir>-<name>` rather than by version, which would collide with another
 * PR's entry while both are unversioned in `latest`.
 *
 * @param version version `nx migrate` gates the bump on
 */
export const nxPackageJsonUpdates = (
  dir: string,
  version: string,
  nxVersion: string = NX_VERSION,
): PackageJsonUpdates => ({
  [migrationKey(dir, NX_PACKAGE_UPDATES_NAME)]: {
    version,
    packages: Object.fromEntries(
      NX_PACKAGES.map((name) => [
        name,
        { version: nxVersion, alwaysAddToPackageJson: false as const },
      ]),
    ),
  },
});
