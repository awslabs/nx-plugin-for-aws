/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { syncVendedVersions } from '../../utils/version-upgrade-migration/sync-vended-versions';

/**
 * Runs the version sync migration directly, for the version-sync smoke test.
 *
 * The migration itself runs under `nx migrate`, which needs two published
 * versions and a release window. Exposing the same function as a generator lets
 * a test drive it over a real generated workspace on every PR, so the surfaces
 * the generators produce are covered without waiting for a release.
 */
export const internalSyncVendedVersionsGenerator = async (
  tree: Tree,
): Promise<void> => {
  const { nextSteps } = await syncVendedVersions(tree);
  for (const step of nextSteps ?? []) {
    console.log(step);
  }
};

export default internalSyncVendedVersionsGenerator;
