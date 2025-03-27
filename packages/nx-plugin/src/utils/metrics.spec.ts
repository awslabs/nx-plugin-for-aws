/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from './test';
import { sharedConstructsGenerator } from './shared-constructs';
import {
  addGeneratorMetricsIfApplicable,
  METRIC_ID,
  METRICS_ASPECT_FILE_PATH,
  metricsAspectVariableQuery,
} from './metrics';
import { query } from './ast';
import { ArrayLiteralExpression, NodeArray, StringLiteral } from 'typescript';

export const expectHasMetricTags = (tree: Tree, ...metrics: string[]) => {
  const tagsArray = query(
    tree,
    METRICS_ASPECT_FILE_PATH,
    metricsAspectVariableQuery('tags', 'ArrayLiteralExpression'),
  );
  expect(tagsArray).toHaveLength(1);
  const tags = (
    ((tagsArray[0] as ArrayLiteralExpression)?.elements ??
      []) as NodeArray<StringLiteral>
  ).map((t) => t.text);
  expect(tags).toEqual(expect.arrayContaining(metrics));
};

describe('metrics', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should update metrics and version in app.ts', async () => {
    await sharedConstructsGenerator(tree);

    // Create the app.ts file with MetricsAspect class
    const appPath = METRICS_ASPECT_FILE_PATH;

    expect(tree.read(appPath, 'utf-8')).toContain("const id = ''");
    expect(tree.read(appPath, 'utf-8')).toContain("const version = ''");
    expect(tree.read(appPath, 'utf-8')).toContain('const tags: string[] = []');

    // Add metrics
    await addGeneratorMetricsIfApplicable(tree, [
      { id: 'ts#foo', metric: 'g1', resolvedFactoryPath: '/path/to/factory1' },
      { id: 'py#bar', metric: 'g2', resolvedFactoryPath: '/path/to/factory2' },
    ]);

    // Check if app.ts was updated with metrics
    expect(tree.read(appPath, 'utf-8')).toContain(`const id = '${METRIC_ID}'`);
    expect(tree.read(appPath, 'utf-8')).toContain("const version = '0.0.0'");
    expect(tree.read(appPath, 'utf-8')).toContain(
      "const tags: string[] = ['g1', 'g2']",
    );
    expectHasMetricTags(tree, 'g1', 'g2');

    // Run generator again with different metrics info, some overlapping and some not
    await addGeneratorMetricsIfApplicable(tree, [
      { id: 'ts#foo', metric: 'g1', resolvedFactoryPath: '/path/to/factory1' },
      { id: 'py#baz', metric: 'g3', resolvedFactoryPath: '/path/to/factory3' },
    ]);

    // Check app.ts retains existing tags and adds the new one
    expect(tree.read(appPath, 'utf-8')).toContain(`const id = '${METRIC_ID}'`);
    expect(tree.read(appPath, 'utf-8')).toContain("const version = '0.0.0'");
    expect(tree.read(appPath, 'utf-8')).toContain(
      "const tags: string[] = ['g1', 'g2', 'g3']",
    );
    expectHasMetricTags(tree, 'g1', 'g2', 'g3');
  });

  it('should not throw when no app.ts exists', async () => {
    await addGeneratorMetricsIfApplicable(tree, [
      { id: 'ts#foo', metric: 'g1', resolvedFactoryPath: '/path/to/factory1' },
      { id: 'py#bar', metric: 'g2', resolvedFactoryPath: '/path/to/factory2' },
    ]);
  });

  it('should not throw when no MetricsAspect exists', async () => {
    tree.write(METRICS_ASPECT_FILE_PATH, `export const foo = 'bar';`);

    await addGeneratorMetricsIfApplicable(tree, [
      { id: 'ts#foo', metric: 'g1', resolvedFactoryPath: '/path/to/factory1' },
      { id: 'py#bar', metric: 'g2', resolvedFactoryPath: '/path/to/factory2' },
    ]);
  });
});
