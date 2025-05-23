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

    await pyLambdaFunctionGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventSource: 'Any',
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
    expect(pyprojectToml.project.dependencies).toContain(
      'aws-lambda-powertools[parser]',
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

    await pyLambdaFunctionGenerator(tree, {
      project: 'test-project',
      functionName: 'test-function',
      eventSource: 'Any',
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
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets.bundle).toBeDefined();
    expect(projectConfig.targets.bundle.options.commands[0]).toContain(
      `--project test_project`,
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
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, LAMBDA_FUNCTION_GENERATOR_INFO.metric);
  });
});
