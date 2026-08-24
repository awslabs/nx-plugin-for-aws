/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { expect } from 'vitest';
import {
  METRIC_ID,
  METRICS_ASPECT_FILE_PATH,
  TERRAFORM_METRICS_FILE_PATH,
} from './metrics';

/**
 * Asserts that the MetricsAspect tags array in the CDK app.ts file
 * contains the expected metric tags.
 *
 * Uses simple string matching on the file content — the tags array
 * in the generated file has the form: const tags: string[] = ['g1', 'g2']
 */
export const expectHasMetricTags = (tree: Tree, ...metrics: string[]) => {
  const content = tree.read(METRICS_ASPECT_FILE_PATH, 'utf-8');
  expect(content).toBeTruthy();

  // Extract the tags array content from the file
  const tagsMatch = content!.match(
    /const tags:\s*string\[\]\s*=\s*\[([^\]]*)\]/,
  );
  expect(tagsMatch).toBeTruthy();

  // Parse individual tag strings from the array literal
  const tagsContent = tagsMatch![1];
  const tags = tagsContent
    ? (tagsContent.match(/'([^']*)'/g)?.map((t) => t.slice(1, -1)) ?? [])
    : [];

  expect(tags).toEqual(expect.arrayContaining(metrics));
};

/**
 * Asserts that the Terraform metrics locals block contains the expected
 * metric_id, metric_version, and metric_tags values.
 */
export const expectHasTerraformMetricTags = (
  tree: Tree,
  ...metrics: string[]
) => {
  const content = tree.read(TERRAFORM_METRICS_FILE_PATH, 'utf-8');
  expect(content).toBeTruthy();

  // Check metric_id
  expect(content).toContain(`metric_id = "${METRIC_ID}"`);

  // Check metric_version
  expect(content).toContain('metric_version = "0.0.0"');

  // Check metric_tags
  const tagsMatch = content!.match(/metric_tags\s*=\s*\[([^\]]*)\]/);
  expect(tagsMatch).toBeTruthy();
  const tags =
    tagsMatch![1].match(/"([^"]*)"/g)?.map((t) => t.slice(1, -1)) ?? [];
  metrics.forEach((metric) => {
    expect(tags).toContain(metric);
  });
};
