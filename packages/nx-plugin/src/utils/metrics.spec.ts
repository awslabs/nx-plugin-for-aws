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
  TERRAFORM_METRICS_FILE_PATH,
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

export const expectHasTerraformMetricTags = (
  tree: Tree,
  ...metrics: string[]
) => {
  const content = tree.read(TERRAFORM_METRICS_FILE_PATH, 'utf-8');
  expect(content).toBeTruthy();

  // Extract the description from the CloudFormation template
  const descriptionMatch = content.match(/Description\s*=\s*"([^"]*)"/);
  expect(descriptionMatch).toBeTruthy();

  const description = descriptionMatch[1];

  // Check for metric ID and version
  expect(description).toContain(METRIC_ID);
  expect(description).toContain('version:0.0.0');

  // Check for tags
  const tagMatch = description.match(/\(tag:([^)]*)\)/);
  if (metrics.length > 0) {
    expect(tagMatch).toBeTruthy();
    const tags = tagMatch[1].split(',').map((tag) => tag.trim());
    metrics.forEach((metric) => {
      expect(tags).toContain(metric);
    });
  }
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
      {
        id: 'ts#foo',
        metric: 'g1',
        resolvedFactoryPath: '/path/to/factory1',
        resolvedSchemaPath: '/path/to/schema1',
        description: 'Test generator 1',
      },
      {
        id: 'py#bar',
        metric: 'g2',
        resolvedFactoryPath: '/path/to/factory2',
        resolvedSchemaPath: '/path/to/schema2',
        description: 'Test generator 2',
      },
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
      {
        id: 'ts#foo',
        metric: 'g1',
        resolvedFactoryPath: '/path/to/factory1',
        resolvedSchemaPath: '/path/to/schema1',
        description: 'Test generator 1',
      },
      {
        id: 'py#baz',
        metric: 'g3',
        resolvedFactoryPath: '/path/to/factory3',
        resolvedSchemaPath: '/path/to/schema3',
        description: 'Test generator 3',
      },
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
      {
        id: 'ts#foo',
        metric: 'g1',
        resolvedFactoryPath: '/path/to/factory1',
        resolvedSchemaPath: '/path/to/schema1',
        description: 'Test generator 1',
      },
      {
        id: 'py#bar',
        metric: 'g2',
        resolvedFactoryPath: '/path/to/factory2',
        resolvedSchemaPath: '/path/to/schema2',
        description: 'Test generator 2',
      },
    ]);
  });

  it('should not throw when no MetricsAspect exists', async () => {
    tree.write(METRICS_ASPECT_FILE_PATH, `export const foo = 'bar';`);

    await addGeneratorMetricsIfApplicable(tree, [
      {
        id: 'ts#foo',
        metric: 'g1',
        resolvedFactoryPath: '/path/to/factory1',
        resolvedSchemaPath: '/path/to/schema1',
        description: 'Test generator 1',
      },
      {
        id: 'py#bar',
        metric: 'g2',
        resolvedFactoryPath: '/path/to/factory2',
        resolvedSchemaPath: '/path/to/schema2',
        description: 'Test generator 2',
      },
    ]);
  });

  describe('terraform metrics', () => {
    it('should update metrics in terraform metrics.tf file', async () => {
      // Create shared constructs for Terraform
      await sharedConstructsGenerator(tree, { iacProvider: 'Terraform' });

      // Verify the metrics.tf file was created
      expect(tree.exists(TERRAFORM_METRICS_FILE_PATH)).toBe(true);

      const initialContent = tree.read(TERRAFORM_METRICS_FILE_PATH, 'utf-8');
      expect(initialContent).toContain('Description = " (version:) (tag:)"');

      // Add metrics
      await addGeneratorMetricsIfApplicable(tree, [
        {
          id: 'terraform#foo',
          metric: 'tf1',
          resolvedFactoryPath: '/path/to/factory1',
          resolvedSchemaPath: '/path/to/schema1',
          description: 'Terraform generator 1',
        },
        {
          id: 'terraform#bar',
          metric: 'tf2',
          resolvedFactoryPath: '/path/to/factory2',
          resolvedSchemaPath: '/path/to/schema2',
          description: 'Terraform generator 2',
        },
      ]);

      // Check if metrics.tf was updated with metrics
      const updatedContent = tree.read(TERRAFORM_METRICS_FILE_PATH, 'utf-8');
      expect(updatedContent).toContain(
        `Description = "(${METRIC_ID}) (version:0.0.0) (tag:tf1,tf2)"`,
      );
      expectHasTerraformMetricTags(tree, 'tf1', 'tf2');
    });

    it('should add new metrics to existing terraform metrics', async () => {
      // Create shared constructs for Terraform
      await sharedConstructsGenerator(tree, { iacProvider: 'Terraform' });

      // Add initial metrics
      await addGeneratorMetricsIfApplicable(tree, [
        {
          id: 'terraform#foo',
          metric: 'tf1',
          resolvedFactoryPath: '/path/to/factory1',
          resolvedSchemaPath: '/path/to/schema1',
          description: 'Terraform generator 1',
        },
      ]);

      expectHasTerraformMetricTags(tree, 'tf1');

      // Add more metrics (some overlapping, some new)
      await addGeneratorMetricsIfApplicable(tree, [
        {
          id: 'terraform#foo',
          metric: 'tf1',
          resolvedFactoryPath: '/path/to/factory1',
          resolvedSchemaPath: '/path/to/schema1',
          description: 'Terraform generator 1',
        },
        {
          id: 'terraform#baz',
          metric: 'tf3',
          resolvedFactoryPath: '/path/to/factory3',
          resolvedSchemaPath: '/path/to/schema3',
          description: 'Terraform generator 3',
        },
      ]);

      // Check that both old and new metrics are present
      expectHasTerraformMetricTags(tree, 'tf1', 'tf3');

      const content = tree.read(TERRAFORM_METRICS_FILE_PATH, 'utf-8');
      expect(content).toContain(
        `Description = "(${METRIC_ID}) (version:0.0.0) (tag:tf1,tf3)"`,
      );
    });

    it('should not throw when terraform metrics file does not exist', async () => {
      // Don't create shared constructs, so metrics.tf won't exist
      await expect(
        addGeneratorMetricsIfApplicable(tree, [
          {
            id: 'terraform#foo',
            metric: 'tf1',
            resolvedFactoryPath: '/path/to/factory1',
            resolvedSchemaPath: '/path/to/schema1',
            description: 'Terraform generator 1',
          },
        ]),
      ).resolves.not.toThrow();
    });

    it('should handle empty metrics gracefully for terraform', async () => {
      await sharedConstructsGenerator(tree, { iacProvider: 'Terraform' });

      await addGeneratorMetricsIfApplicable(tree, []);

      // Should not throw and file should still exist
      expect(tree.exists(TERRAFORM_METRICS_FILE_PATH)).toBe(true);
    });

    it('should work with both CDK and Terraform metrics simultaneously', async () => {
      // Create both CDK and Terraform shared constructs
      await sharedConstructsGenerator(tree); // CDK (default)
      await sharedConstructsGenerator(tree, { iacProvider: 'Terraform' });

      // Add metrics - should update both files
      await addGeneratorMetricsIfApplicable(tree, [
        {
          id: 'mixed#generator',
          metric: 'mixed1',
          resolvedFactoryPath: '/path/to/factory1',
          resolvedSchemaPath: '/path/to/schema1',
          description: 'Mixed generator',
        },
      ]);

      // Check CDK metrics
      expect(tree.exists(METRICS_ASPECT_FILE_PATH)).toBe(true);
      expectHasMetricTags(tree, 'mixed1');

      // Check Terraform metrics
      expect(tree.exists(TERRAFORM_METRICS_FILE_PATH)).toBe(true);
      expectHasTerraformMetricTags(tree, 'mixed1');
    });
  });
});
