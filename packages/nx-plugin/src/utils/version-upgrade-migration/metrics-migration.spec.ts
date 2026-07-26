/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  METRICS_ASPECT_FILE_PATH,
  TERRAFORM_METRICS_FILE_PATH,
} from '../metrics';
import { getPackageVersion } from '../nx';
import { createTreeUsingTsSolutionSetup } from '../test';
import migration from './metrics-migration';

const metricsAspect = (
  version: string,
) => `export class MetricsAspect implements IAspect {
  public visit(node: IConstruct): void {
    const id = 'uksb-4wk0bqpg5s';
    const version = '${version}';
    const tags: string[] = ['g1', 'g2'];
  }
}
`;

const metricsTf = (version: string) => `locals {
  metric_id = "uksb-4wk0bqpg5s"
  metric_version = "${version}"
  metric_tags = ["g1", "g2"]
}

output "note" {
  value = "reported as metric_version"
}
`;

describe('sync-metrics-version migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should record the installed plugin version in both metrics files', async () => {
    tree.write(METRICS_ASPECT_FILE_PATH, metricsAspect('0.1.0'));
    tree.write(TERRAFORM_METRICS_FILE_PATH, metricsTf('0.1.0'));

    await migration(tree);

    const version = getPackageVersion();
    expect(tree.read(METRICS_ASPECT_FILE_PATH, 'utf-8')).toContain(
      `const version = '${version}'`,
    );
    expect(tree.read(TERRAFORM_METRICS_FILE_PATH, 'utf-8')).toContain(
      `metric_version = "${version}"`,
    );
  });

  it('should leave the metric id and tags to the generators', async () => {
    tree.write(METRICS_ASPECT_FILE_PATH, metricsAspect('0.1.0'));
    tree.write(TERRAFORM_METRICS_FILE_PATH, metricsTf('0.1.0'));

    await migration(tree);

    const aspect = tree.read(METRICS_ASPECT_FILE_PATH, 'utf-8')!;
    const terraform = tree.read(TERRAFORM_METRICS_FILE_PATH, 'utf-8')!;
    expect(aspect).toContain(`const id = 'uksb-4wk0bqpg5s'`);
    expect(aspect).toContain(`const tags: string[] = ['g1', 'g2']`);
    expect(terraform).toContain('metric_id = "uksb-4wk0bqpg5s"');
    expect(terraform).toContain('metric_tags = ["g1", "g2"]');
    // A mention of `metric_version` outside the locals block is not a value.
    expect(terraform).toContain('value = "reported as metric_version"');
  });

  it('should do nothing when the workspace has no metrics files', async () => {
    const { nextSteps } = await migration(tree);

    expect(nextSteps).toEqual([]);
    expect(tree.exists(METRICS_ASPECT_FILE_PATH)).toBe(false);
    expect(tree.exists(TERRAFORM_METRICS_FILE_PATH)).toBe(false);
  });

  it('should handle a workspace with only one of the two metrics files', async () => {
    tree.write(TERRAFORM_METRICS_FILE_PATH, metricsTf('0.1.0'));

    await migration(tree);

    expect(tree.read(TERRAFORM_METRICS_FILE_PATH, 'utf-8')).toContain(
      `metric_version = "${getPackageVersion()}"`,
    );
  });

  it('should be idempotent', async () => {
    tree.write(METRICS_ASPECT_FILE_PATH, metricsAspect('0.1.0'));
    tree.write(TERRAFORM_METRICS_FILE_PATH, metricsTf('0.1.0'));

    await migration(tree);
    const afterFirstRun = {
      aspect: tree.read(METRICS_ASPECT_FILE_PATH, 'utf-8'),
      terraform: tree.read(TERRAFORM_METRICS_FILE_PATH, 'utf-8'),
    };

    await migration(tree);

    expect({
      aspect: tree.read(METRICS_ASPECT_FILE_PATH, 'utf-8'),
      terraform: tree.read(TERRAFORM_METRICS_FILE_PATH, 'utf-8'),
    }).toEqual(afterFirstRun);
  });
});
