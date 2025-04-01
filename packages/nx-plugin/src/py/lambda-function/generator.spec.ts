/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import {
  LAMBDA_FUNCTION_GENERATOR_INFO,
  lambdaFunctionProjectGenerator,
} from './generator';
import { parse } from '@iarna/toml';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import { joinPathFragments } from '@nx/devkit';
import { sortObjectKeys } from '../../utils/object';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { UVPyprojectToml } from '@nxlv/python/src/provider/uv/types';

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

    await lambdaFunctionProjectGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventType: 'Any',
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

    await lambdaFunctionProjectGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventType: 'Any',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_project/project.json', 'utf-8'),
    );

    // Verify Lambda Function-specific targets
    expect(projectConfig.targets.bundle).toBeDefined();
    expect(projectConfig.targets.bundle.outputs).toEqual([
      '{workspaceRoot}/dist/apps/test_project/bundle',
    ]);
    expect(projectConfig.targets.bundle.options.commands).toContain(
      'uv export --frozen --no-dev --no-editable --project test_project -o dist/apps/test_project/bundle/requirements.txt',
    );

    // Verify build dependencies
    expect(projectConfig.targets.build.dependsOn).toContain('bundle');

    const pyprojectToml = parse(
      tree.read('apps/test_project/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;

    // Verify project dependencies
    expect(pyprojectToml.project.dependencies).toContain(
      'aws-lambda-powertools',
    );
    expect(pyprojectToml.project.dependencies).toContain(
      'aws-lambda-powertools[tracer]',
    );
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

    await lambdaFunctionProjectGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventType: 'Any',
    });

    // Verify shared constructs files
    const lambdaHandlerPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'lambda-functions',
      'test-function.ts',
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
      './test-function.js',
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

    await lambdaFunctionProjectGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventType: 'Any',
    });

    const sharedConstructsConfig = JSON.parse(
      tree.read(
        joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'project.json'),
        'utf-8',
      ),
    );

    expect(sharedConstructsConfig.targets.build.dependsOn).toContain(
      'proj.test_function:build',
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

    await lambdaFunctionProjectGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      functionPath: 'nested/path',
      eventType: 'Any',
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

    await lambdaFunctionProjectGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventType: 'Any',
    });

    const lambdaFunctionPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'lambda-functions',
      'test-function.ts',
    );
    const lambdaFunctionContent = tree.read(lambdaFunctionPath, 'utf-8');

    expect(lambdaFunctionContent).toContain(
      'export class TestFunction extends Function',
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

    await lambdaFunctionProjectGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventType: 'APIGatewayProxyEvent',
    });

    const lambdaFunctionContent = tree.read(
      'apps/test_project/test_project/test_function.py',
      'utf-8',
    );

    expect(lambdaFunctionContent).toContain(
      'from aws_lambda_powertools.utilities.data_classes import APIGatewayProxyEvent, event_source',
    );
    expect(lambdaFunctionContent).toContain(
      '@event_source(data_class=APIGatewayProxyEvent)',
    );
    expect(lambdaFunctionContent).toContain(
      'def lambda_handler(event: APIGatewayProxyEvent, context: LambdaContext)',
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

    await lambdaFunctionProjectGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventType: 'Any',
    });

    const appChanges = sortObjectKeys(
      tree
        .listChanges()
        .filter((f) => f.path.endsWith('.py'))
        .reduce((acc, curr) => {
          acc[curr.path] = tree.read(curr.path, 'utf-8');
          return acc;
        }, {}),
    );
    // Verify project metadata
    expect(appChanges).toMatchSnapshot('main-snapshot');
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

    await lambdaFunctionProjectGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventType: 'Any',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, LAMBDA_FUNCTION_GENERATOR_INFO.metric);
  });
});
