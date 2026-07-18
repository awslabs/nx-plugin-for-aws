/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { parse } from '@iarna/toml';
import { getProjects, readJson, type Tree } from '@nx/devkit';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { PY_PROJECT_GENERATOR_INFO, pyProjectGenerator } from './generator';

describe('python project generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate a python project with correct structure', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });

    // Verify project structure
    expect(tree.exists('apps/test_project')).toBeTruthy();
    expect(tree.exists('apps/test_project/pyproject.toml')).toBeTruthy();
    expect(tree.exists('apps/test_project/proj_test_project')).toBeTruthy();
    expect(tree.exists('apps/test_project/tests')).toBeTruthy();

    // Verify hello.py files are removed
    expect(
      tree.exists('apps/test_project/proj_test_project/hello.py'),
    ).toBeFalsy();
    expect(tree.exists('apps/test_project/tests/test_hello.py')).toBeFalsy();

    // Verify placeholder test is added
    expect(tree.exists('apps/test_project/tests/test_noop.py')).toBeTruthy();
  });

  it('should set up project configuration correctly', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_project/project.json', 'utf-8'),
    );

    // Verify project targets
    expect(projectConfig.targets.build).toBeDefined();
    expect(projectConfig.targets.compile).toBeDefined();
    expect(projectConfig.targets.test).toBeDefined();
    expect(projectConfig.targets.lint).toBeDefined();
    expect(projectConfig.targets.typecheck).toBeDefined();

    // Verify build target dependencies
    expect(projectConfig.targets.build.dependsOn).toContain('compile');
    expect(projectConfig.targets.build.dependsOn).toContain('test');
    expect(projectConfig.targets.build.dependsOn).toContain('lint');
    expect(projectConfig.targets.build.dependsOn).toContain('typecheck');
  });

  it('should configure typecheck target to run ty', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_project/project.json', 'utf-8'),
    );

    expect(projectConfig.targets.typecheck).toEqual({
      cache: true,
      inputs: ['default', '^production'],
      executor: '@nxlv/python:run-commands',
      options: {
        command: 'uv run ty check',
        cwd: '{projectRoot}',
      },
    });
  });

  it('should add ty as a dev dependency in the root pyproject.toml', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });

    const rootPyproject = parse(tree.read('pyproject.toml', 'utf-8'));

    expect((rootPyproject as any)['dependency-groups']?.dev).toEqual(
      expect.arrayContaining([expect.stringMatching(/^ty==/)]),
    );
  });

  it('pins ruff to an exact version in the root pyproject.toml', async () => {
    // Must match the pinned ruff generation-time formatting runs
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });

    const rootPyproject = parse(tree.read('pyproject.toml', 'utf-8'));

    expect((rootPyproject as any)['dependency-groups']?.dev).toEqual(
      expect.arrayContaining([expect.stringMatching(/^ruff==/)]),
    );
  });

  it('should configure python dependencies correctly', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });

    const pyprojectToml = parse(
      tree.read('apps/test_project/pyproject.toml', 'utf-8'),
    );

    // Verify python version
    expect(pyprojectToml.project['requires-python']).toBe('>=3.14');

    // Verify dev dependencies include pytest
    expect(pyprojectToml['tool']['pytest']['ini_options']).toBeDefined();
  });

  it('should set up nx configuration correctly', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
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
      type: 'application',
      moduleName: 'custom_module',
    });

    expect(tree.exists('apps/test_project/custom_module')).toBeTruthy();
    expect(tree.exists('apps/test_project/tests')).toBeTruthy();
  });

  it('should ignore additional build artifacts', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });
    const rootGitIgnorePatterns =
      tree.read('.gitignore', 'utf-8')?.split('\n') ?? [];
    expect(rootGitIgnorePatterns).toContain('/reports');

    const projectGitIgnorePatterns =
      tree.read('apps/test_project/.gitignore', 'utf-8')?.split('\n') ?? [];
    expect(projectGitIgnorePatterns).toContain('**/__pycache__');
    expect(projectGitIgnorePatterns).toContain('.coverage');
    // pytest-cov's per-process data files, deleted after they are combined.
    expect(projectGitIgnorePatterns).toContain('.coverage.*');
    // Tool cache directories — also keeps `ty` from scanning pytest's transient
    // `pytest-cache-files-*` dirs (it respects .gitignore) and failing the
    // concurrent typecheck with an I/O error.
    expect(projectGitIgnorePatterns).toContain('.pytest_cache');
    expect(projectGitIgnorePatterns).toContain('pytest-cache-files-*');
    expect(projectGitIgnorePatterns).toContain('.ruff_cache');
  });

  it('should exclude transient artifacts from the compile copy', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_project/project.json', 'utf-8'),
    );

    // The build executor copies the project to a temp folder honouring
    // `ignorePaths` (not .gitignore), so the transient files a concurrent
    // test/typecheck target deletes must be excluded here to avoid an ENOENT
    // race mid-copy.
    const ignorePaths = projectConfig.targets.compile.options.ignorePaths;
    expect(ignorePaths).toContain('tests');
    expect(ignorePaths).toContain('.coverage');
    expect(ignorePaths).toContain('.coverage.*');
    expect(ignorePaths).toContain('.pytest_cache');
    expect(ignorePaths).toContain('pytest-cache-files-*');
    expect(ignorePaths).toContain('.ruff_cache');
  });

  it('should add a dependency on the python plugin', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });
    const packageJson = readJson(tree, 'package.json');
    expect(packageJson.devDependencies).toHaveProperty('@nxlv/python');
  });

  it('should add generator to project metadata', async () => {
    // Call the generator function
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });

    expect(
      readJson(tree, 'apps/test_project/project.json').metadata,
    ).toHaveProperty('generator', PY_PROJECT_GENERATOR_INFO.id);
  });

  it('should add generator metric to app.ts', async () => {
    // Set up test tree with shared constructs
    await sharedConstructsGenerator(tree, { iac: 'cdk' });

    // Call the generator function
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, PY_PROJECT_GENERATOR_INFO.metric);
  });

  it('should set line-length to 120 in pyproject.toml', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });

    const pyprojectToml = parse(
      tree.read('apps/test_project/pyproject.toml', 'utf-8'),
    );

    // Verify ruff line-length is set to 120
    expect((pyprojectToml.tool as any)?.ruff?.['line-length']).toBe(120);
  });

  it('should configure lint target to depend on format target', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_project/project.json', 'utf-8'),
    );

    // Verify lint target exists
    expect(projectConfig.targets.lint).toBeDefined();

    // Verify format target exists
    expect(projectConfig.targets.format).toBeDefined();

    // Verify lint target depends on format
    expect(projectConfig.targets.lint.dependsOn).toContain('format');
  });

  it('should configure the format target to check by default with fix and skip-lint', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_project/project.json', 'utf-8'),
    );

    expect(projectConfig.targets.format.options.check).toBe(true);
    expect(projectConfig.targets.format.cache).toBe(true);

    expect(projectConfig.targets.format.configurations.fix).toEqual({
      check: false,
    });
    expect(projectConfig.targets.format.configurations['skip-lint']).toEqual({
      check: false,
    });
  });

  it('should configure cache, fix and skip-lint on the project lint target', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test_project/project.json', 'utf-8'),
    );

    // Verify cache is set on the project lint target
    expect(projectConfig.targets.lint.cache).toBe(true);

    // Verify configurations are set on the project lint target
    expect(projectConfig.targets.lint.configurations).toBeDefined();
    expect(projectConfig.targets.lint.configurations.fix).toEqual({
      fix: true,
    });
    expect(projectConfig.targets.lint.configurations['skip-lint']).toEqual({
      exitZero: true,
    });
  });

  it('should not add executor-based target defaults for ruff-check', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });

    const nxJson = JSON.parse(tree.read('nx.json', 'utf-8'));

    // Verify no executor-based ruff-check target defaults exist
    expect(
      nxJson.targetDefaults?.['@nxlv/python:ruff-check'],
    ).not.toBeDefined();
  });

  it('should place project in subDirectory when provided', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'packages',
      subDirectory: 'libs',
      type: 'library',
    });
    expect(tree.exists('packages/libs')).toBeTruthy();
    expect(tree.exists('packages/libs/pyproject.toml')).toBeTruthy();
  });

  it('should be idempotent when re-run with same options', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });

    const projectCountAfterFirstRun = getProjects(tree).size;
    const nxJsonAfterFirstRun = tree.read('nx.json', 'utf-8');

    // Re-running with the same options must not throw
    await expect(
      pyProjectGenerator(tree, {
        name: 'test-project',
        directory: 'apps',
        type: 'application',
      }),
    ).resolves.toBeDefined();

    expect(getProjects(tree).size).toBe(projectCountAfterFirstRun);

    // nx.json must not be rewritten on re-run (the @nxlv/python plugin is
    // already registered), which would otherwise reserialize/reformat it.
    expect(tree.read('nx.json', 'utf-8')).toBe(nxJsonAfterFirstRun);

    // The compile and build targets must not be corrupted on re-run: compile
    // keeps its python build executor, and build's dependsOn is not duplicated.
    const config = readJson(tree, 'apps/test_project/project.json');
    expect(config.targets.compile.executor).toBe('@nxlv/python:build');
    expect(config.targets.build.dependsOn).toEqual([
      'lint',
      'compile',
      'test',
      'typecheck',
    ]);
  });

  it('should create an independent project with a different name', async () => {
    await pyProjectGenerator(tree, {
      name: 'test-project',
      directory: 'apps',
      type: 'application',
    });

    await pyProjectGenerator(tree, {
      name: 'other-project',
      directory: 'apps',
      type: 'application',
    });

    expect(tree.exists('apps/test_project/pyproject.toml')).toBeTruthy();
    expect(tree.exists('apps/other_project/pyproject.toml')).toBeTruthy();

    const projectNames = [...getProjects(tree).keys()];
    expect(projectNames).toContain('proj.test_project');
    expect(projectNames).toContain('proj.other_project');
  });
});
