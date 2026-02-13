/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, updateJson } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import {
  LAMBDA_FUNCTION_GENERATOR_INFO,
  pyLambdaFunctionGenerator,
} from './generator';
import { parse } from '@iarna/toml';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import { joinPathFragments } from '@nx/devkit';
import { sortObjectKeys } from '../../utils/object';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import type { UVPyprojectToml } from '../../utils/nxlv-python';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils';

describe('lambda-handler project generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate a lambda function in a project with correct structure', async () => {
    // Setup a Python project
    tree.write(
      'apps/test_project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test_project',
        sourceRoot: 'apps/test_project/test_project',
        targets: {},
      }),
    );

    tree.write(
      'apps/test_project/pyproject.toml',
      `[project]
          dependencies = []
      `,
    );

    await pyLambdaFunctionGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventSource: 'Any',
      iacProvider: 'CDK',
    });

    expect(
      tree.exists('apps/test_project/test_project/test_function.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test_project/tests/test_test_function.py'),
    ).toBeTruthy();
  });

  it('should set up project configuration with Lambda Function targets', async () => {
    tree.write(
      'apps/test_project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test_project',
        sourceRoot: 'apps/test_project/test_project',
        targets: {
          build: {
            dependsOn: ['lint', 'compile', 'test'],
            options: {
              outputPath: '{workspaceRoot}/dist/apps/test_project',
            },
          },
        },
      }),
    );

    tree.write(
      'apps/test_project/pyproject.toml',
      `[project]
          dependencies = []
      `,
    );

    await pyLambdaFunctionGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventSource: 'Any',
      iacProvider: 'CDK',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_project/project.json', 'utf-8'),
    );

    // Verify Lambda Function-specific targets
    expect(projectConfig.targets['bundle-x86']).toBeDefined();
    expect(projectConfig.targets['bundle-x86'].outputs).toEqual([
      '{workspaceRoot}/dist/apps/test_project/bundle-x86',
    ]);
    expect(projectConfig.targets['bundle-x86'].options.commands).toContain(
      'uv export --frozen --no-dev --no-editable --project apps/test_project --package test-project -o dist/apps/test_project/bundle-x86/requirements.txt',
    );

    // Verify build dependencies
    expect(projectConfig.targets.build.dependsOn).toContain('bundle');

    const pyprojectToml = parse(
      tree.read('apps/test_project/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;

    // Verify project dependencies
    expect(
      pyprojectToml.project.dependencies.some((dep) =>
        dep.startsWith('aws-lambda-powertools=='),
      ),
    ).toBe(true);
    expect(
      pyprojectToml.project.dependencies.some((dep) =>
        dep.startsWith('aws-lambda-powertools[tracer]=='),
      ),
    ).toBe(true);
    expect(
      pyprojectToml.project.dependencies.some((dep) =>
        dep.startsWith('aws-lambda-powertools[parser]=='),
      ),
    ).toBe(true);
  });

  it('should set up shared constructs for Lambda Handler', async () => {
    tree.write(
      'apps/test_project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test_project',
        sourceRoot: 'apps/test_project/test_project',
        targets: {
          build: {
            dependsOn: ['lint', 'compile', 'test'],
            options: {
              outputPath: '{workspaceRoot}/dist/apps/test_project',
            },
          },
        },
      }),
    );

    tree.write(
      'apps/test_project/pyproject.toml',
      `[project]
          dependencies = []
      `,
    );

    await pyLambdaFunctionGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventSource: 'Any',
      iacProvider: 'CDK',
    });

    // Verify shared constructs files
    const lambdaHandlerPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'lambda-functions',
      'test-project-test-function.ts',
    );

    expect(tree.exists(lambdaHandlerPath)).toBeTruthy();

    // Verify exports in index files
    const lambdaHandlersIndexPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'lambda-functions',
      'index.ts',
    );
    expect(tree.read(lambdaHandlersIndexPath, 'utf-8')).toContain(
      './test-project-test-function.js',
    );

    const appIndexPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'index.ts',
    );
    expect(tree.read(appIndexPath, 'utf-8')).toContain(
      './lambda-functions/index.js',
    );
  });

  it('should update shared constructs build dependencies', async () => {
    tree.write(
      'apps/test_project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test_project',
        sourceRoot: 'apps/test_project/test_project',
        targets: {
          build: {
            dependsOn: ['lint', 'compile', 'test'],
            options: {
              outputPath: '{workspaceRoot}/dist/apps/test_project',
            },
          },
        },
      }),
    );

    tree.write(
      'apps/test_project/pyproject.toml',
      `[project]
          dependencies = []
      `,
    );

    await pyLambdaFunctionGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventSource: 'Any',
      iacProvider: 'CDK',
    });

    const sharedConstructsConfig = JSON.parse(
      tree.read(
        joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'project.json'),
        'utf-8',
      ),
    );

    expect(sharedConstructsConfig.targets.build.dependsOn).toContain(
      'test-project:build',
    );
  });

  it('should handle custom directory path', async () => {
    tree.write(
      'apps/test_project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test_project',
        sourceRoot: 'apps/test_project/test_project',
        targets: {
          build: {
            dependsOn: ['lint', 'compile', 'test'],
            options: {
              outputPath: '{workspaceRoot}/dist/apps/test_project',
            },
          },
        },
      }),
    );

    tree.write(
      'apps/test_project/pyproject.toml',
      `[project]
          dependencies = []
      `,
    );

    await pyLambdaFunctionGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      functionPath: 'nested/path',
      eventSource: 'Any',
      iacProvider: 'CDK',
    });

    expect(
      tree.exists(
        'apps/test_project/test_project/nested/path/test_function.py',
      ),
    ).toBeTruthy();
  });

  it('should generate Lambda Function construct with correct class name', async () => {
    tree.write(
      'apps/test_project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test_project',
        sourceRoot: 'apps/test_project/test_project',
        targets: {
          build: {
            dependsOn: ['lint', 'compile', 'test'],
            options: {
              outputPath: '{workspaceRoot}/dist/apps/test_project',
            },
          },
        },
      }),
    );

    tree.write(
      'apps/test_project/pyproject.toml',
      `[project]
          dependencies = []
      `,
    );

    await pyLambdaFunctionGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventSource: 'Any',
      iacProvider: 'CDK',
    });

    const lambdaFunctionPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'lambda-functions',
      'test-project-test-function.ts',
    );
    const lambdaFunctionContent = tree.read(lambdaFunctionPath, 'utf-8');

    expect(lambdaFunctionContent).toContain(
      'export class TestProjectTestFunction extends Function',
    );
  });

  it('should handle custom event type in python handler file', async () => {
    tree.write(
      'apps/test_project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test_project',
        sourceRoot: 'apps/test_project/test_project',
        targets: {
          build: {
            dependsOn: ['lint', 'compile', 'test'],
            options: {
              outputPath: '{workspaceRoot}/dist/apps/test_project',
            },
          },
        },
      }),
    );

    tree.write(
      'apps/test_project/pyproject.toml',
      `[project]
          dependencies = []
      `,
    );

    await pyLambdaFunctionGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventSource: 'APIGatewayProxyEventModel',
      iacProvider: 'CDK',
    });

    const lambdaFunctionContent = tree.read(
      'apps/test_project/test_project/test_function.py',
      'utf-8',
    );

    expect(lambdaFunctionContent).toContain(
      'from aws_lambda_powertools.utilities.parser import event_parser',
    );
    expect(lambdaFunctionContent).toContain(
      'from aws_lambda_powertools.utilities.parser.models import APIGatewayProxyEventModel',
    );
    expect(lambdaFunctionContent).toContain(
      '@event_parser(model=APIGatewayProxyEventModel)',
    );
    expect(lambdaFunctionContent).toContain(
      'def lambda_handler(event: APIGatewayProxyEventModel, context: LambdaContext)',
    );
  });

  it('should match snapshot', async () => {
    tree.write(
      'apps/test_project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test_project',
        sourceRoot: 'apps/test_project/test_project',
        targets: {
          build: {
            dependsOn: ['lint', 'compile', 'test'],
            options: {
              outputPath: '{workspaceRoot}/dist/apps/test_project',
            },
          },
        },
      }),
    );

    tree.write(
      'apps/test_project/pyproject.toml',
      `[project]
          dependencies = []
      `,
    );

    await pyLambdaFunctionGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventSource: 'Any',
      iacProvider: 'CDK',
    });

    const appChanges = sortObjectKeys(
      tree
        .listChanges()
        .filter(
          (f) =>
            f.path.endsWith('.py') ||
            f.path.startsWith(
              'packages/common/constructs/src/app/lambda-functions',
            ),
        )
        .reduce((acc, curr) => {
          acc[curr.path] = tree.read(curr.path, 'utf-8');
          return acc;
        }, {}),
    );
    // Verify project metadata
    expect(appChanges).toMatchSnapshot('main-snapshot');
  });

  it('should generate a lambda function when an unqualified name is specified', async () => {
    updateJson(tree, 'package.json', (packageJson) => ({
      ...packageJson,
      name: '@my-scope/source',
    }));
    // Setup a Python project with a fully qualified name
    tree.write(
      'apps/test_project/project.json',
      JSON.stringify({
        name: 'my_scope.test_project',
        root: 'apps/test_project',
        sourceRoot: 'apps/test_project/test_project',
        targets: {},
      }),
    );

    tree.write(
      'apps/test_project/pyproject.toml',
      `[project]
          dependencies = []
      `,
    );

    await pyLambdaFunctionGenerator(tree, {
      project: 'test_project',
      functionName: 'test-function',
      eventSource: 'Any',
      iacProvider: 'CDK',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['bundle-x86']).toBeDefined();
    expect(projectConfig.targets['bundle-x86'].options.commands[0]).toContain(
      `--project apps/test_project`,
    );
  });

  it('should add generator metric to app.ts', async () => {
    // Call the generator function
    tree.write(
      'apps/test_project/project.json',
      JSON.stringify({
        name: 'test-project',
        root: 'apps/test_project',
        sourceRoot: 'apps/test_project/test_project',
        targets: {
          build: {
            dependsOn: ['lint', 'compile', 'test'],
            options: {
              outputPath: '{workspaceRoot}/dist/apps/test_project',
            },
          },
        },
      }),
    );

    tree.write(
      'apps/test_project/pyproject.toml',
      `[project]
          dependencies = []
      `,
    );

    await pyLambdaFunctionGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventSource: 'Any',
      iacProvider: 'CDK',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, LAMBDA_FUNCTION_GENERATOR_INFO.metric);
  });

  describe('terraform iacProvider', () => {
    it('should generate terraform files for python lambda function and snapshot them', async () => {
      tree.write(
        'apps/test_project/project.json',
        JSON.stringify({
          name: 'test-project',
          root: 'apps/test_project',
          sourceRoot: 'apps/test_project/test_project',
          targets: {
            build: {
              dependsOn: ['lint', 'compile', 'test'],
              options: {
                outputPath: '{workspaceRoot}/dist/apps/test_project',
              },
            },
          },
        }),
      );

      tree.write(
        'apps/test_project/pyproject.toml',
        `[project]
            dependencies = []
        `,
      );

      await pyLambdaFunctionGenerator(tree, {
        project: 'test-project',
        functionName: 'test-function',
        eventSource: 'Any',
        iacProvider: 'Terraform',
      });

      // Find all terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      // Verify terraform files are created
      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the specific terraform file for the lambda function
      const lambdaFunctionTerraformFile = terraformFiles.find((f) =>
        f.includes('test-project-test-function'),
      );

      expect(lambdaFunctionTerraformFile).toBeDefined();

      // Read terraform file content
      const terraformContent = tree.read(lambdaFunctionTerraformFile!, 'utf-8');

      // Verify python lambda function configuration
      expect(terraformContent).toMatch(
        /handler\s+=\s+"test_project\.test_function\.lambda_handler"/,
      );
      expect(terraformContent).toMatch(/runtime\s+=\s+"python3\.12"/);
      expect(terraformContent).toContain('test-project-test-function');

      // Snapshot terraform file
      const terraformFileContents = {
        'test-project-test-function.tf': terraformContent,
      };

      expect(terraformFileContents).toMatchSnapshot(
        'terraform-python-lambda-files',
      );
    });

    it('should generate terraform files with custom function path', async () => {
      tree.write(
        'apps/test_project/project.json',
        JSON.stringify({
          name: 'test-project',
          root: 'apps/test_project',
          sourceRoot: 'apps/test_project/test_project',
          targets: {
            build: {
              dependsOn: ['lint', 'compile', 'test'],
              options: {
                outputPath: '{workspaceRoot}/dist/apps/test_project',
              },
            },
          },
        }),
      );

      tree.write(
        'apps/test_project/pyproject.toml',
        `[project]
            dependencies = []
        `,
      );

      await pyLambdaFunctionGenerator(tree, {
        project: 'test-project',
        functionName: 'test-function',
        functionPath: 'lambda-functions',
        eventSource: 'Any',
        iacProvider: 'Terraform',
      });

      // Find terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      expect(terraformFiles.length).toBeGreaterThan(0);

      const lambdaFunctionTerraformFile = terraformFiles.find((f) =>
        f.includes('test-project-test-function'),
      );

      expect(lambdaFunctionTerraformFile).toBeDefined();

      const terraformContent = tree.read(lambdaFunctionTerraformFile!, 'utf-8');

      // Verify the correct bundle path is used for custom function path
      expect(terraformContent).toContain('dist/apps/test_project/bundle');
    });

    it('should generate terraform files with different event sources', async () => {
      tree.write(
        'apps/test_project/project.json',
        JSON.stringify({
          name: 'test-project',
          root: 'apps/test_project',
          sourceRoot: 'apps/test_project/test_project',
          targets: {
            build: {
              dependsOn: ['lint', 'compile', 'test'],
              options: {
                outputPath: '{workspaceRoot}/dist/apps/test_project',
              },
            },
          },
        }),
      );

      tree.write(
        'apps/test_project/pyproject.toml',
        `[project]
            dependencies = []
        `,
      );

      await pyLambdaFunctionGenerator(tree, {
        project: 'test-project',
        functionName: 'test-function',
        eventSource: 'APIGatewayProxyEventModel',
        iacProvider: 'Terraform',
      });

      // Find terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      expect(terraformFiles.length).toBeGreaterThan(0);

      const lambdaFunctionTerraformFile = terraformFiles.find((f) =>
        f.includes('test-project-test-function'),
      );

      expect(lambdaFunctionTerraformFile).toBeDefined();

      const terraformContent = tree.read(lambdaFunctionTerraformFile!, 'utf-8');

      // Verify python lambda function configuration is still correct regardless of event source
      expect(terraformContent).toMatch(
        /handler\s+=\s+"test_project\.test_function\.lambda_handler"/,
      );
      expect(terraformContent).toMatch(/runtime\s+=\s+"python3\.12"/);
    });

    it('should configure project targets and dependencies correctly for terraform', async () => {
      tree.write(
        'apps/test_project/project.json',
        JSON.stringify({
          name: 'test-project',
          root: 'apps/test_project',
          sourceRoot: 'apps/test_project/test_project',
          targets: {
            build: {
              dependsOn: ['lint', 'compile', 'test'],
              options: {
                outputPath: '{workspaceRoot}/dist/apps/test_project',
              },
            },
          },
        }),
      );

      tree.write(
        'apps/test_project/pyproject.toml',
        `[project]
            dependencies = []
        `,
      );

      await pyLambdaFunctionGenerator(tree, {
        project: 'test-project',
        functionName: 'test-function',
        eventSource: 'Any',
        iacProvider: 'Terraform',
      });

      // Check that shared terraform project has build dependency on the lambda function project
      const sharedTerraformConfig = JSON.parse(
        tree.read('packages/common/terraform/project.json', 'utf-8'),
      );

      expect(sharedTerraformConfig.targets.build.dependsOn).toContain(
        'test-project:build',
      );

      // Verify project configuration still has basic targets
      const projectConfig = JSON.parse(
        tree.read('apps/test_project/project.json', 'utf-8'),
      );

      // Should still have bundle and build targets
      expect(projectConfig.targets.build).toBeDefined();
      expect(projectConfig.targets['bundle-x86']).toBeDefined();
    });

    it('should not create CDK constructs when using terraform', async () => {
      tree.write(
        'apps/test_project/project.json',
        JSON.stringify({
          name: 'test-project',
          root: 'apps/test_project',
          sourceRoot: 'apps/test_project/test_project',
          targets: {
            build: {
              dependsOn: ['lint', 'compile', 'test'],
              options: {
                outputPath: '{workspaceRoot}/dist/apps/test_project',
              },
            },
          },
        }),
      );

      tree.write(
        'apps/test_project/pyproject.toml',
        `[project]
            dependencies = []
        `,
      );

      await pyLambdaFunctionGenerator(tree, {
        project: 'test-project',
        functionName: 'test-function',
        eventSource: 'Any',
        iacProvider: 'Terraform',
      });

      // Verify CDK files are NOT created
      expect(
        tree.exists(
          'packages/common/constructs/src/app/lambda-functions/test-project-test-function.ts',
        ),
      ).toBeFalsy();
    });

    it('should throw error for invalid iacProvider', async () => {
      tree.write(
        'apps/test_project/project.json',
        JSON.stringify({
          name: 'test-project',
          root: 'apps/test_project',
          sourceRoot: 'apps/test_project/test_project',
          targets: {},
        }),
      );

      tree.write(
        'apps/test_project/pyproject.toml',
        `[project]
            dependencies = []
        `,
      );

      await expect(
        pyLambdaFunctionGenerator(tree, {
          project: 'test-project',
          functionName: 'test-function',
          eventSource: 'Any',
          iacProvider: 'InvalidProvider' as any,
        }),
      ).rejects.toThrow('Unsupported iacProvider InvalidProvider');
    });

    it('should handle terraform with scoped project names', async () => {
      updateJson(tree, 'package.json', (packageJson) => ({
        ...packageJson,
        name: '@myorg/workspace',
      }));

      tree.write(
        'apps/scoped_project/project.json',
        JSON.stringify({
          name: 'myorg.scoped_project',
          root: 'apps/scoped_project',
          sourceRoot: 'apps/scoped_project/scoped_project',
          targets: {
            build: {
              dependsOn: ['lint', 'compile', 'test'],
              options: {
                outputPath: '{workspaceRoot}/dist/apps/scoped_project',
              },
            },
          },
        }),
      );

      tree.write(
        'apps/scoped_project/pyproject.toml',
        `[project]
            dependencies = []
        `,
      );

      await pyLambdaFunctionGenerator(tree, {
        project: 'scoped_project',
        functionName: 'test-function',
        eventSource: 'Any',
        iacProvider: 'Terraform',
      });

      // Verify terraform files are created
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the lambda function terraform file
      const lambdaFunctionTerraformFile = terraformFiles.find((f) =>
        f.includes('scoped-project-test-function'),
      );
      expect(lambdaFunctionTerraformFile).toBeDefined();

      const terraformContent = tree.read(lambdaFunctionTerraformFile!, 'utf-8');

      // Verify the correct bundle path is used for scoped projects
      expect(terraformContent).toContain('dist/apps/scoped_project/bundle');
    });

    it('should handle terraform with complex function names', async () => {
      tree.write(
        'apps/test_project/project.json',
        JSON.stringify({
          name: 'test-project',
          root: 'apps/test_project',
          sourceRoot: 'apps/test_project/test_project',
          targets: {
            build: {
              dependsOn: ['lint', 'compile', 'test'],
              options: {
                outputPath: '{workspaceRoot}/dist/apps/test_project',
              },
            },
          },
        }),
      );

      tree.write(
        'apps/test_project/pyproject.toml',
        `[project]
            dependencies = []
        `,
      );

      await pyLambdaFunctionGenerator(tree, {
        project: 'test-project',
        functionName: 'My Complex Function Name!',
        functionPath: 'nested/path',
        eventSource: 'Any',
        iacProvider: 'Terraform',
      });

      // Verify terraform files are created
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the lambda function terraform file with normalized name
      const lambdaFunctionTerraformFile = terraformFiles.find((f) =>
        f.includes('test-project-my-complex-function-name'),
      );
      expect(lambdaFunctionTerraformFile).toBeDefined();

      const terraformContent = tree.read(lambdaFunctionTerraformFile!, 'utf-8');

      // Verify the correct bundle path is used for complex function names
      expect(terraformContent).toContain('dist/apps/test_project/bundle');
    });

    it('should match snapshot for terraform generated files with different configurations', async () => {
      tree.write(
        'apps/test_project/project.json',
        JSON.stringify({
          name: 'test-project',
          root: 'apps/test_project',
          sourceRoot: 'apps/test_project/test_project',
          targets: {
            build: {
              dependsOn: ['lint', 'compile', 'test'],
              options: {
                outputPath: '{workspaceRoot}/dist/apps/test_project',
              },
            },
          },
        }),
      );

      tree.write(
        'apps/test_project/pyproject.toml',
        `[project]
            dependencies = []
        `,
      );

      await pyLambdaFunctionGenerator(tree, {
        project: 'test-project',
        functionName: 'SnapshotFunction',
        eventSource: 'APIGatewayProxyEventModel',
        iacProvider: 'Terraform',
      });

      // Find terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      const lambdaFunctionTerraformFile = terraformFiles.find((f) =>
        f.includes('test-project-snapshot-function'),
      );

      expect(lambdaFunctionTerraformFile).toBeDefined();

      // Snapshot the generated terraform file
      const terraformContent = tree.read(lambdaFunctionTerraformFile!, 'utf-8');

      expect(terraformContent).toMatchSnapshot(
        'terraform-python-lambda-snapshot-function.tf',
      );
    });

    it('should handle Python bundle target configuration for terraform', async () => {
      tree.write(
        'apps/test_project/project.json',
        JSON.stringify({
          name: 'test-project',
          root: 'apps/test_project',
          sourceRoot: 'apps/test_project/test_project',
          targets: {
            build: {
              dependsOn: ['lint', 'compile', 'test'],
              options: {
                outputPath: '{workspaceRoot}/dist/apps/test_project',
              },
            },
          },
        }),
      );

      tree.write(
        'apps/test_project/pyproject.toml',
        `[project]
            dependencies = []
        `,
      );

      await pyLambdaFunctionGenerator(tree, {
        project: 'test-project',
        functionName: 'test-function',
        eventSource: 'Any',
        iacProvider: 'Terraform',
      });

      const projectConfig = JSON.parse(
        tree.read('apps/test_project/project.json', 'utf-8'),
      );

      // Check that bundle target was configured with Python-specific options
      expect(projectConfig.targets['bundle-x86']).toBeDefined();
      expect(projectConfig.targets['bundle-x86'].outputs).toEqual([
        '{workspaceRoot}/dist/apps/test_project/bundle-x86',
      ]);

      // Check the exact commands for the bundle target
      const commands = projectConfig.targets['bundle-x86'].options.commands;
      expect(commands).toContain(
        'uv export --frozen --no-dev --no-editable --project apps/test_project --package test-project -o dist/apps/test_project/bundle-x86/requirements.txt',
      );

      // Verify build dependencies
      expect(projectConfig.targets.build.dependsOn).toContain('bundle');
    });

    it('should inherit iacProvider from config when set to Inherit', async () => {
      // Set up config with CDK provider using utility methods
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        iac: {
          provider: 'CDK',
        },
      });

      tree.write(
        'apps/test_project/project.json',
        JSON.stringify({
          name: 'test-project',
          root: 'apps/test_project',
          sourceRoot: 'apps/test_project/test_project',
          targets: {},
        }),
      );

      tree.write(
        'apps/test_project/pyproject.toml',
        `[project]
            dependencies = []
        `,
      );

      await pyLambdaFunctionGenerator(tree, {
        project: 'test-project',
        functionName: 'test-function',
        eventSource: 'Any',
        iacProvider: 'Inherit',
      });

      // Verify CDK constructs are created (not terraform)
      expect(tree.exists('packages/common/constructs')).toBeTruthy();
      expect(tree.exists('packages/common/terraform')).toBeFalsy();
      expect(
        tree.exists(
          'packages/common/constructs/src/app/lambda-functions/test-project-test-function.ts',
        ),
      ).toBeTruthy();
    });

    it('should add component generator metadata', async () => {
      tree.write(
        'apps/test_project/project.json',
        JSON.stringify({
          name: 'test-project',
          root: 'apps/test_project',
          sourceRoot: 'apps/test_project/test_project',
          targets: {},
        }),
      );

      tree.write(
        'apps/test_project/pyproject.toml',
        `[project]
          dependencies = []
      `,
      );

      await pyLambdaFunctionGenerator(tree, {
        project: 'test-project',
        functionName: 'test-function',
        eventSource: 'Any',
        iacProvider: 'CDK',
      });

      const projectConfig = JSON.parse(
        tree.read('apps/test_project/project.json', 'utf-8'),
      );

      expect(projectConfig.metadata).toBeDefined();
      expect(projectConfig.metadata.components).toBeDefined();
      expect(projectConfig.metadata.components).toHaveLength(1);
      expect(projectConfig.metadata.components[0]).toEqual({
        generator: LAMBDA_FUNCTION_GENERATOR_INFO.id,
        name: 'test-function',
      });
    });
  });
});
