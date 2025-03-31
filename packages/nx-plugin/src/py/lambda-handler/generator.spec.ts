/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import {
  LAMBDA_HANDLER_GENERATOR_INFO,
  lambdaHandlerProjectGenerator,
} from './generator';
import { parse } from '@iarna/toml';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import { joinPathFragments } from '@nx/devkit';
import { sortObjectKeys } from '../../utils/object';
import { expectHasMetricTags } from '../../utils/metrics.spec';

describe('lambda-handler project generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate a lambda-handler project with correct structure', async () => {
    await lambdaHandlerProjectGenerator(tree, {
      name: 'test-lambda-handler',
      directory: 'apps',
    });

    // Verify project structure
    expect(tree.exists('apps/test_lambda_handler')).toBeTruthy();
    expect(
      tree.exists('apps/test_lambda_handler/test_lambda_handler'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test_lambda_handler/test_lambda_handler/handler.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test_lambda_handler/tests/test_handler.py'),
    ).toBeTruthy();

    // Verify default files are removed
    expect(
      tree.exists('apps/test_lambda_handler/test_lambda_handler/hello.py'),
    ).toBeFalsy();
    expect(
      tree.exists('apps/test_lambda_handler/tests/test_hello.py'),
    ).toBeFalsy();
  });

  it('should set up project configuration with FastAPI targets', async () => {
    await lambdaHandlerProjectGenerator(tree, {
      name: 'test-lambda-handler',
      directory: 'apps',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_lambda_handler/project.json', 'utf-8'),
    );

    // Verify FastAPI-specific targets
    expect(projectConfig.targets.bundle).toBeDefined();
    expect(projectConfig.targets.bundle.outputs).toEqual([
      '{workspaceRoot}/dist/apps/test_lambda_handler/bundle',
    ]);
    expect(projectConfig.targets.bundle.options.commands).toContain(
      'uv export --frozen --no-dev --no-editable --project test_lambda_handler -o dist/apps/test_lambda_handler/bundle/requirements.txt',
    );

    // Verify build dependencies
    expect(projectConfig.targets.build.dependsOn).toContain('bundle');
  });

  it('should set up shared constructs for Lambda Handler', async () => {
    await lambdaHandlerProjectGenerator(tree, {
      name: 'test-lambda-handler',
      directory: 'apps',
    });

    // Verify shared constructs files
    const lambdaHandlerPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'lambda-handlers',
      'test-lambda-handler.ts',
    );

    expect(tree.exists(lambdaHandlerPath)).toBeTruthy();

    // Verify exports in index files
    const lambdaHandlersIndexPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'lambda-handlers',
      'index.ts',
    );
    expect(tree.read(lambdaHandlersIndexPath, 'utf-8')).toContain(
      './test-lambda-handler.js',
    );

    const appIndexPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'index.ts',
    );
    expect(tree.read(appIndexPath, 'utf-8')).toContain(
      './lambda-handlers/index.js',
    );
  });

  it('should update shared constructs build dependencies', async () => {
    await lambdaHandlerProjectGenerator(tree, {
      name: 'test-lambda-handler',
      directory: 'apps',
    });

    const sharedConstructsConfig = JSON.parse(
      tree.read(
        joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'project.json'),
        'utf-8',
      ),
    );

    expect(sharedConstructsConfig.targets.build.dependsOn).toContain(
      'proj.test_lambda_handler:build',
    );
  });

  it('should handle custom directory path', async () => {
    await lambdaHandlerProjectGenerator(tree, {
      name: 'test-lambda-handler',
      directory: 'apps/nested/path',
    });

    expect(tree.exists('apps/nested/path/test_lambda_handler')).toBeTruthy();
    expect(
      tree.exists(
        'apps/nested/path/test_lambda_handler/test_lambda_handler/handler.py',
      ),
    ).toBeTruthy();
  });

  it('should generate Lambda Handler construct with correct class name', async () => {
    await lambdaHandlerProjectGenerator(tree, {
      name: 'test-lambda-handler',
      directory: 'apps',
    });

    const lambdaHandlerPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'lambda-handlers',
      'test-lambda-handler.ts',
    );
    const lambdaHandlerContent = tree.read(lambdaHandlerPath, 'utf-8');

    expect(lambdaHandlerContent).toContain(
      'export class TestLambdaHandler extends LambdaHandler',
    );
  });

  it('should set project metadata', async () => {
    await lambdaHandlerProjectGenerator(tree, {
      name: 'test-lambda-handler',
      directory: 'apps',
    });

    const config = JSON.parse(
      tree.read('apps/test_lambda_handler/project.json', 'utf-8'),
    );
    // Verify project metadata
    expect(config.metadata).toEqual({
      handlerName: 'test-lambda-handler',
    });
  });

  it('should match snapshot', async () => {
    await lambdaHandlerProjectGenerator(tree, {
      name: 'test-lambda-handler',
      directory: 'apps',
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
    await lambdaHandlerProjectGenerator(tree, {
      name: 'test-lambda-handler',
      directory: 'apps',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, LAMBDA_HANDLER_GENERATOR_INFO.metric);
  });
});
