/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { MigrationReturnObject, Tree } from '@nx/devkit';
import { formatFilesInSubtree } from '../format';
import { syncMetricsVersion } from './sync-metrics-version';

/**
 * Records the plugin version the workspace now runs in its metrics files.
 *
 * Registered `everyRelease` because a release that bumps no dependencies
 * registers no version sync, and the reported version would drift behind.
 */
export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  await syncMetricsVersion(tree);
  await formatFilesInSubtree(tree);
  return { nextSteps: [] };
}
