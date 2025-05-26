/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readJson, Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { PY_PROJECT_GENERATOR_INFO, pyProjectGenerator } from './generator';
import { parse } from '@iarna/toml';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { expectHasMetricTags } from '../../utils/metrics.spec';

describe('python project generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate a python project with correct structure', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      projectType: 'application',
    });

    // Verify project structure
    expect(tree.exists('apps/test_project')).toBeTruthy();
    expect(tree.exists('apps/test_project/pyproject.toml')).toBeTruthy();
    expect(tree.exists('apps/test_project/test_project')).toBeTruthy();
    expect(tree.exists('apps/test_project/tests')).toBeTruthy();
  });

  it('should set up project configuration correctly', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      projectType: 'application',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_project/project.json', 'utf-8'),
    );

    // Verify project targets
    expect(projectConfig.targets.build).toBeDefined();
    expect(projectConfig.targets.compile).toBeDefined();
    expect(projectConfig.targets.test).toBeDefined();
    expect(projectConfig.targets.lint).toBeDefined();

    // Verify build target dependencies
    expect(projectConfig.targets.build.dependsOn).toContain('compile');
    expect(projectConfig.targets.build.dependsOn).toContain('test');
    expect(projectConfig.targets.build.dependsOn).toContain('lint');
  });

  it('should configure python dependencies correctly', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      projectType: 'application',
    });

    const pyprojectToml = parse(
      tree.read('apps/test_project/pyproject.toml', 'utf-8'),
    );

    // Verify python version
    expect(pyprojectToml.project['requires-python']).toBe('>=3.12');

    // Verify dev dependencies include pytest
    expect(pyprojectToml['tool']['pytest']['ini_options']).toBeDefined();
  });

  it('should set up nx configuration correctly', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      projectType: 'application',
    });

    const nxJson = JSON.parse(tree.read('nx.json', 'utf-8'));

    // Verify python plugin is configured
    const pythonPlugin = nxJson.plugins.find(
      (p) => typeof p === 'object' && p.plugin === '@nxlv/python',
    );
    expect(pythonPlugin).toBeDefined();
    expect(pythonPlugin.options.packageManager).toBe('uv');
  });

  it('should handle custom module name', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      projectType: 'application',
      moduleName: 'custom_module',
    });

    expect(tree.exists('apps/test_project/custom_module')).toBeTruthy();
    expect(tree.exists('apps/test_project/tests')).toBeTruthy();
  });

  it('should ignore additional build artifacts', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      projectType: 'application',
    });
    const rootGitIgnorePatterns =
      tree.read('.gitignore', 'utf-8')?.split('\n') ?? [];
    expect(rootGitIgnorePatterns).toContain('/reports');

    const projectGitIgnorePatterns =
      tree.read('apps/test_project/.gitignore', 'utf-8')?.split('\n') ?? [];
    expect(projectGitIgnorePatterns).toContain('**/__pycache__');
    expect(projectGitIgnorePatterns).toContain('.coverage');
  });

  it('should add a dependency on the python plugin', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      projectType: 'application',
    });
    const packageJson = readJson(tree, 'package.json');
    expect(packageJson.devDependencies).toHaveProperty('@nxlv/python');
  });

  it('should add generator to project metadata', async () => {
    // Call the generator function
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      projectType: 'application',
    });

    expect(
      readJson(tree, 'apps/test_project/project.json').metadata,
    ).toHaveProperty('generator', PY_PROJECT_GENERATOR_INFO.id);
  });

  it('should add generator metric to app.ts', async () => {
    // Set up test tree with shared constructs
    await sharedConstructsGenerator(tree);

    // Call the generator function
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      projectType: 'application',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, PY_PROJECT_GENERATOR_INFO.metric);
  });
});
