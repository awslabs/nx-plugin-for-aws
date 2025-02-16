/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { pyProjectGenerator } from './generator';
import { parse } from '@iarna/toml';

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
      tree.read('apps/test_project/project.json', 'utf-8')
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
      tree.read('apps/test_project/pyproject.toml', 'utf-8')
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
      (p) => typeof p === 'object' && p.plugin === '@nxlv/python'
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
});
