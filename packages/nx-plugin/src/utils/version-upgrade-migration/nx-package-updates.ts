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
 * Key an nx bump is registered under, named for the nx version it moves to.
 *
 * The plugin version the bump ships under isn't known when it is written — the
 * weekly update writes it, and only the release that publishes it can say which
 * version that is. The nx version, though, is exactly what the entry is *for*,
 * and two bumps to the same nx version would be the same bump — so it keys the
 * entry uniquely from the moment it is written, with no re-keying later.
 *
 * That matters because each release's bump has to stay behind as the next is
 * written: a workspace several releases behind gets every nx hop in turn rather
 * than only the newest. A key that had to be rewritten once the plugin version
 * was known would let a second bump land on the first before either shipped.
 */
export const nxPackageUpdatesKey = (nxVersion: string) =>
  `nx-${nxVersion}-${NX_PACKAGE_UPDATES_NAME}`;

/**
 * `alwaysAddToPackageJson: false` so only packages already present are updated.
 *
 * @param version plugin version `nx migrate` gates the bump on, or
 *   {@link LATEST_MIGRATIONS_DIR} while it is still waiting for a release
 */
export const nxPackageJsonUpdates = (
  version: string,
  nxVersion: string = NX_VERSION,
): PackageJsonUpdates => ({
  [nxPackageUpdatesKey(nxVersion)]: {
    version,
    packages: Object.fromEntries(
      NX_PACKAGES.map((name) => [
        name,
        { version: nxVersion, alwaysAddToPackageJson: false as const },
      ]),
    ),
  },
});
