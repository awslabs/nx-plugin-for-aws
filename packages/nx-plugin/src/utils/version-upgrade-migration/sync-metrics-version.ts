/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { applyGritQL } from '../ast';
import {
  METRICS_ASPECT_FILE_PATH,
  TERRAFORM_METRICS_FILE_PATH,
} from '../metrics';
import { getPackageVersion } from '../nx';

/**
 * Sync the plugin version the metrics files report, so usage is attributed to
 * the release the workspace actually runs. The metric id and tags are owned by
 * the generators and left alone.
 *
 * @returns the metrics files that changed
 */
export const syncMetricsVersion = async (tree: Tree): Promise<string[]> => {
  const version = getPackageVersion();
  const updated: string[] = [];

  if (tree.exists(METRICS_ASPECT_FILE_PATH)) {
    const changed = await applyGritQL(
      tree,
      METRICS_ASPECT_FILE_PATH,
      `\`const version = $old\` => \`const version = '${version}'\`` +
        ' where { $old <: within `class MetricsAspect implements $_ { $_ }` }',
    );
    if (changed) {
      updated.push(METRICS_ASPECT_FILE_PATH);
    }
  }

  if (tree.exists(TERRAFORM_METRICS_FILE_PATH)) {
    // GritQL's HCL grammar rejects `within locals { ... }`, so the match is
    // narrowed to a string value to skip interpolated mentions.
    const changed = await applyGritQL(
      tree,
      TERRAFORM_METRICS_FILE_PATH,
      `\`metric_version = $old\` => \`metric_version = "${version}"\`` +
        ' where { $old <: string() }',
    );
    if (changed) {
      updated.push(TERRAFORM_METRICS_FILE_PATH);
    }
  }

  return updated;
};
