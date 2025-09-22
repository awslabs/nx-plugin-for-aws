/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, Tree } from '@nx/devkit';
import {
  smithyProjectGenerator,
  SMITHY_PROJECT_GENERATOR_INFO,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { expectHasMetricTags } from '../../utils/metrics.spec';

describe('smithyProjectGenerator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate smithy project with default options', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
    });

    // Verify directory structure
    expect(tree.exists('test-api/src/main.smithy')).toBeTruthy();
    expect(tree.exists('test-api/src/operations/echo.smithy')).toBeTruthy();
    expect(tree.exists('test-api/build.Dockerfile')).toBeTruthy();
    expect(tree.exists('test-api/smithy-build.json')).toBeTruthy();
    expect(tree.exists('test-api/project.json')).toBeTruthy();

    // Verify project configuration
    const projectConfig = readJson(tree, 'test-api/project.json');
    expect(projectConfig.name).toBe('@proj/test-api');
    expect(projectConfig.projectType).toBe('library');
    expect(projectConfig.sourceRoot).toBe('test-api/src');
    expect(projectConfig.targets.build).toBeDefined();
    expect(projectConfig.targets.compile).toBeDefined();

    // Verify compile target configuration
    expect(projectConfig.targets.compile.executor).toBe('nx:run-commands');
    expect(projectConfig.targets.compile.options.commands).toEqual([
      'rimraf dist/test-api/build',
      'make-dir dist/test-api/build',
      'docker build -f test-api/build.Dockerfile --target export --output type=local,dest=dist/test-api/build test-api',
    ]);
    expect(projectConfig.targets.compile.outputs).toEqual([
      '{workspaceRoot}/dist/{projectRoot}/build',
    ]);
    expect(projectConfig.targets.build.dependsOn).toEqual(['compile']);

    // Create snapshots of generated files
    expect(tree.read('test-api/src/main.smithy', 'utf-8')).toMatchSnapshot(
      'main.smithy',
    );
    expect(
      tree.read('test-api/src/operations/echo.smithy', 'utf-8'),
    ).toMatchSnapshot('echo.smithy');
    expect(tree.read('test-api/build.Dockerfile', 'utf-8')).toMatchSnapshot(
      'build.Dockerfile',
    );
    expect(tree.read('test-api/smithy-build.json', 'utf-8')).toMatchSnapshot(
      'smithy-build.json',
    );
    expect(tree.read('test-api/project.json', 'utf-8')).toMatchSnapshot(
      'project.json',
    );
  });

  it('should generate smithy project with custom service name', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
      serviceName: 'CustomService',
    });

    const mainSmithy = tree.read('test-api/src/main.smithy', 'utf-8');
    expect(mainSmithy).toContain('service CustomService');
    expect(mainSmithy).toContain('@title("CustomService")');
    expect(mainSmithy).toMatchSnapshot('custom-service-main.smithy');
  });

  it('should generate smithy project with custom namespace', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
      namespace: 'com.example.custom',
    });

    const mainSmithy = tree.read('test-api/src/main.smithy', 'utf-8');
    expect(mainSmithy).toContain('namespace com.example.custom');
    expect(mainSmithy).toMatchSnapshot('custom-namespace-main.smithy');
  });

  it('should generate smithy project with custom directory', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
      directory: 'apis',
    });

    // Verify directory structure
    expect(tree.exists('apis/test-api')).toBeTruthy();
    expect(tree.exists('apis/test-api/src')).toBeTruthy();
    expect(tree.exists('apis/test-api/src/main.smithy')).toBeTruthy();
    expect(tree.exists('apis/test-api/project.json')).toBeTruthy();

    // Verify project configuration
    const projectConfig = readJson(tree, 'apis/test-api/project.json');
    expect(projectConfig.sourceRoot).toBe('apis/test-api/src');
    expect(tree.read('apis/test-api/project.json', 'utf-8')).toMatchSnapshot(
      'custom-dir-project.json',
    );
  });

  it('should generate smithy project with subdirectory', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
      directory: 'services',
      subDirectory: 'model',
    });

    // Verify directory structure
    expect(tree.exists('services/model')).toBeTruthy();
    expect(tree.exists('services/model/src')).toBeTruthy();
    expect(tree.exists('services/model/src/main.smithy')).toBeTruthy();
    expect(tree.exists('services/model/project.json')).toBeTruthy();

    // Verify project configuration
    const projectConfig = readJson(tree, 'services/model/project.json');
    expect(projectConfig.sourceRoot).toBe('services/model/src');
    expect(tree.read('services/model/project.json', 'utf-8')).toMatchSnapshot(
      'subdir-project.json',
    );
  });

  it('should generate smithy project with all custom options', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
      serviceName: 'MyCustomService',
      namespace: 'com.mycompany.api',
      directory: 'backend',
      subDirectory: 'model',
    });

    // Verify directory structure
    expect(tree.exists('backend/model')).toBeTruthy();
    expect(tree.exists('backend/model/src/main.smithy')).toBeTruthy();

    const mainSmithy = tree.read('backend/model/src/main.smithy', 'utf-8');
    expect(mainSmithy).toContain('namespace com.mycompany.api');
    expect(mainSmithy).toContain('service MyCustomService');
    expect(mainSmithy).toContain('@title("MyCustomService")');

    const projectConfig = readJson(tree, 'backend/model/project.json');
    expect(projectConfig.sourceRoot).toBe('backend/model/src');

    expect(mainSmithy).toMatchSnapshot('all-custom-main.smithy');
    expect(tree.read('backend/model/project.json', 'utf-8')).toMatchSnapshot(
      'all-custom-project.json',
    );
  });

  it('should use npm scope for default namespace', async () => {
    // Set up npm scope in package.json
    const packageJson = readJson(tree, 'package.json');
    packageJson.name = '@myorg/workspace';
    tree.write('package.json', JSON.stringify(packageJson, null, 2));

    await smithyProjectGenerator(tree, {
      name: 'test-api',
    });

    const mainSmithy = tree.read('test-api/src/main.smithy', 'utf-8');
    expect(mainSmithy).toContain('namespace myorg');
    expect(mainSmithy).toMatchSnapshot('npm-scope-main.smithy');
  });

  it('should add generator metadata to project configuration', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
    });

    const projectConfig = readJson(tree, 'test-api/project.json');
    expect(projectConfig.metadata).toHaveProperty(
      'generator',
      SMITHY_PROJECT_GENERATOR_INFO.id,
    );
    expect(projectConfig.metadata).toHaveProperty('apiName', 'test-api');
  });

  it('should add generator metric to app.ts when shared constructs exist', async () => {
    // Set up test tree with shared constructs
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

    // Call the generator function
    await smithyProjectGenerator(tree, {
      name: 'test-api',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, SMITHY_PROJECT_GENERATOR_INFO.metric);
  });

  it('should handle kebab-case conversion for service names', async () => {
    await smithyProjectGenerator(tree, {
      name: 'my-test-api',
      serviceName: 'MyTestService',
    });

    const mainSmithy = tree.read('my-test-api/src/main.smithy', 'utf-8');
    expect(mainSmithy).toContain('service MyTestService');
    expect(mainSmithy).toMatchSnapshot('kebab-case-main.smithy');

    const smithyBuild = tree.read('my-test-api/smithy-build.json', 'utf-8');
    expect(smithyBuild).toMatchSnapshot('kebab-case-smithy-build.json');
  });

  it('should generate valid Docker build configuration', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
    });

    const dockerfile = tree.read('test-api/build.Dockerfile', 'utf-8');
    expect(dockerfile).toContain(
      'FROM public.ecr.aws/docker/library/node:24 AS builder',
    );
    expect(dockerfile).toMatchSnapshot('dockerfile');

    const projectConfig = readJson(tree, 'test-api/project.json');
    const dockerCommand = projectConfig.targets.compile.options.commands[2];
    expect(dockerCommand).toBe(
      'docker build -f test-api/build.Dockerfile --target export --output type=local,dest=dist/test-api/build test-api',
    );
  });

  it('should configure proper build dependencies', async () => {
    await smithyProjectGenerator(tree, {
      name: 'test-api',
    });

    const projectConfig = readJson(tree, 'test-api/project.json');
    expect(projectConfig.targets.build.dependsOn).toContain('compile');
    expect(projectConfig.targets.compile.cache).toBe(true);
  });

  it('should handle empty service name by using project name', async () => {
    await smithyProjectGenerator(tree, {
      name: 'my-service',
      serviceName: undefined,
    });

    const mainSmithy = tree.read('my-service/src/main.smithy', 'utf-8');
    expect(mainSmithy).toContain('service MyService');
    expect(mainSmithy).toContain('@title("MyService")');
    expect(mainSmithy).toMatchSnapshot('default-service-name-main.smithy');
  });
});
