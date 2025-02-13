/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { fastApiProjectGenerator } from './generator';
import { parse } from '@iarna/toml';
import { PACKAGES_DIR, SHARED_CONSTRUCTS_DIR } from '../../utils/shared-constructs';
import { joinPathFragments } from '@nx/devkit';
import { UVPyprojectToml } from '@nxlv/python/src/provider/uv/types';

describe('fastapi project generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate a FastAPI project with correct structure', async () => {
    await fastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
    });

    // Verify project structure
    expect(tree.exists('apps/test_api')).toBeTruthy();
    expect(tree.exists('apps/test_api/test_api')).toBeTruthy();
    expect(tree.exists('apps/test_api/test_api/main.py')).toBeTruthy();
    expect(tree.exists('apps/test_api/tests/test_main.py')).toBeTruthy();

    // Verify default files are removed
    expect(tree.exists('apps/test_api/test_api/hello.py')).toBeFalsy();
    expect(tree.exists('apps/test_api/tests/test_hello.py')).toBeFalsy();
  });

  it('should set up project configuration with FastAPI targets', async () => {
    await fastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_api/project.json', 'utf-8')
    );

    // Verify FastAPI-specific targets
    expect(projectConfig.targets.bundle).toBeDefined();
    expect(projectConfig.targets.bundle.outputs).toEqual([
      '{workspaceRoot}/dist/apps/test_api/bundle',
    ]);
    expect(projectConfig.targets.bundle.options.commands).toContain(
      'uv export --frozen --no-dev --no-editable --project test_api -o dist/apps/test_api/bundle/requirements.txt'
    );

    // Verify start target for development
    expect(projectConfig.targets.serve).toBeDefined();
    expect(projectConfig.targets.serve.executor).toBe('@nxlv/python:run-commands');
    expect(projectConfig.targets.serve.options.command).toBe(
      'uv run fastapi dev test_api/main.py'
    );

    // Verify build dependencies
    expect(projectConfig.targets.build.dependsOn).toContain('bundle');
  });

  it('should configure FastAPI dependencies', async () => {
    await fastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
    });

    const pyprojectToml = parse(
      tree.read('apps/test_api/pyproject.toml', 'utf-8')
    ) as UVPyprojectToml;

    // Verify FastAPI dependencies
    expect(pyprojectToml.project.dependencies).toContain('fastapi');
    expect(pyprojectToml.project.dependencies).toContain('mangum');
    expect(pyprojectToml['dependency-groups'].dev).toContain('fastapi[standard]>=0.115');
  });

  it('should set up shared constructs for HTTP API', async () => {
    await fastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
    });

    // Verify shared constructs files
    const httpApiPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'http-apis',
      'test-api.ts'
    );
    expect(tree.exists(httpApiPath)).toBeTruthy();

    // Verify exports in index files
    const httpApisIndexPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'http-apis',
      'index.ts'
    );
    expect(tree.read(httpApisIndexPath, 'utf-8')).toContain(
      './test-api.js'
    );

    const appIndexPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'index.ts'
    );
    expect(tree.read(appIndexPath, 'utf-8')).toContain(
      './http-apis/index.js'
    );
  });

  it('should update shared constructs build dependencies', async () => {
    await fastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
    });

    const sharedConstructsConfig = JSON.parse(
      tree.read(
        joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'project.json'),
        'utf-8'
      )
    );

    expect(sharedConstructsConfig.targets.build.dependsOn).toContain(
      'proj.test_api:build'
    );
  });

  it('should handle custom directory path', async () => {
    await fastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps/nested/path',
    });

    expect(tree.exists('apps/nested/path/test_api')).toBeTruthy();
    expect(tree.exists('apps/nested/path/test_api/test_api/main.py')).toBeTruthy();
  });

  it('should generate HTTP API construct with correct class name', async () => {
    await fastApiProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apps',
    });

    const httpApiPath = joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'app',
      'http-apis',
      'test-api.ts'
    );
    const httpApiContent = tree.read(httpApiPath, 'utf-8');

    expect(httpApiContent).toContain('export class TestApi extends HttpApi');
  });
});
