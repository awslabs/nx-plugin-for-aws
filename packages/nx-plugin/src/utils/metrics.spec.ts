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

describe('metrics', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should update metrics and version in app.ts', async () => {
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

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

  it('should handle multi-line formatted tags array correctly', async () => {
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });
    const appPath = METRICS_ASPECT_FILE_PATH;

    // Simulate a multi-line tags array (as prettier would format it)
    const content = tree.read(appPath, 'utf-8')!;
    tree.write(
      appPath,
      content.replace(
        'const tags: string[] = []',
        "const tags: string[] = [\n        'g1',\n        'g2',\n        'g3',\n      ]",
      ),
    );

    // Add new metrics — should not produce double commas
    await addGeneratorMetricsIfApplicable(tree, [
      {
        id: 'ts#new',
        metric: 'g4',
        resolvedFactoryPath: '/path/to/factory',
        resolvedSchemaPath: '/path/to/schema',
        description: 'New generator',
      },
    ]);

    const result = tree.read(appPath, 'utf-8')!;
    expect(result).not.toContain(',,');
    expect(result).toContain("'g4'");
    expectHasMetricTags(tree, 'g1', 'g2', 'g3', 'g4');
    expect(result).not.toContain("'g1', 'g1'");
  });

  it('should handle many tags added across multiple calls', async () => {
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });
    const appPath = METRICS_ASPECT_FILE_PATH;

    for (let batch = 0; batch < 3; batch++) {
      const metrics = Array.from({ length: 5 }, (_, i) => ({
        id: `gen#g${batch * 5 + i + 1}`,
        metric: `g${batch * 5 + i + 1}`,
        resolvedFactoryPath: '/path/to/factory',
        resolvedSchemaPath: '/path/to/schema',
        description: `Generator ${batch * 5 + i + 1}`,
      }));
      await addGeneratorMetricsIfApplicable(tree, metrics);
    }

    const result = tree.read(appPath, 'utf-8')!;
    expect(result).not.toContain(',,');
    for (let i = 1; i <= 15; i++) {
      expect(result).toContain(`'g${i}'`);
    }
  });

  describe('terraform metrics', () => {
    it('should update metrics in terraform metrics.tf file', async () => {
      // Create shared constructs for Terraform
      await sharedConstructsGenerator(tree, { iacProvider: 'Terraform' });

      // Verify the metrics.tf file was created
      expect(tree.exists(TERRAFORM_METRICS_FILE_PATH)).toBe(true);

      const initialContent = tree.read(TERRAFORM_METRICS_FILE_PATH, 'utf-8');
      expect(initialContent).toContain('metric_id      = ""');
      expect(initialContent).toContain('metric_version = ""');
      expect(initialContent).toContain('metric_tags    = []');

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

      // Check if metrics.tf was updated with metrics in locals
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

    it('should handle multi-line formatted terraform tags array correctly', async () => {
      await sharedConstructsGenerator(tree, { iacProvider: 'Terraform' });

      // Simulate a multi-line tags array
      const content = tree.read(TERRAFORM_METRICS_FILE_PATH, 'utf-8')!;
      tree.write(
        TERRAFORM_METRICS_FILE_PATH,
        content.replace(
          'metric_tags    = []',
          'metric_tags = [\n    "tf1",\n    "tf2",\n    "tf3",\n  ]',
        ),
      );

      // Add new metrics
      await addGeneratorMetricsIfApplicable(tree, [
        {
          id: 'terraform#new',
          metric: 'tf4',
          resolvedFactoryPath: '/path/to/factory',
          resolvedSchemaPath: '/path/to/schema',
          description: 'New terraform generator',
        },
      ]);

      const result = tree.read(TERRAFORM_METRICS_FILE_PATH, 'utf-8')!;
      expect(result).not.toContain(',,');
      expect(result).toContain('"tf4"');
      expectHasTerraformMetricTags(tree, 'tf1', 'tf2', 'tf3', 'tf4');
    });

    it('should work with both CDK and Terraform metrics simultaneously', async () => {
      // Create both CDK and Terraform shared constructs
      await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });
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
