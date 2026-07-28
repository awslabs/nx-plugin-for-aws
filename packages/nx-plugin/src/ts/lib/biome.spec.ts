/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readProjectConfiguration, type Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { configureBiomeLint } from './biome';
import tsProjectGenerator from './generator';

describe('configureBiomeLint', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = createTreeUsingTsSolutionSetup();
    await tsProjectGenerator(tree, {
      name: 'test',
      preferInstallDependencies: false,
    });
  });

  it('should configure a biome lint target when a root biome.json exists', () => {
    const { targets } = readProjectConfiguration(tree, '@proj/test');
    expect(targets.lint.executor).toBe('nx:run-commands');
    expect(targets.lint.options.command).toBe('biome lint {projectRoot}');
    expect(targets.lint.configurations.fix.command).toBe(
      'biome check --write {projectRoot}',
    );
    // skip-lint must be a cross-platform no-op (`true` is unavailable on Windows)
    expect(targets.lint.configurations['skip-lint'].command).toBe('node -e ""');
    expect(targets.lint.inputs).toEqual(['biome']);
  });

  it('should configure a biome format target when a root biome.json exists', () => {
    const { targets } = readProjectConfiguration(tree, '@proj/test');
    expect(targets.format.executor).toBe('nx:run-commands');
    // The base format target checks formatting (does not write)
    expect(targets.format.options.command).toBe('biome format {projectRoot}');
    expect(targets.format.configurations.fix.command).toBe(
      'biome format --write {projectRoot}',
    );
    // skip-lint must be a cross-platform no-op (`true` is unavailable on Windows)
    expect(targets.format.configurations['skip-lint'].command).toBe(
      'node -e ""',
    );
    expect(targets.format.inputs).toEqual(['biome']);
  });

  it('should make the lint target depend on the format target', () => {
    const { targets } = readProjectConfiguration(tree, '@proj/test');
    expect(targets.lint.dependsOn).toContain('format');
  });

  it('should make the lint and format targets no-ops when there is no root biome.json', async () => {
    tree.delete('biome.json');
    await configureBiomeLint(tree, {
      dir: 'test',
      fullyQualifiedName: '@proj/test',
    });
    const { targets } = readProjectConfiguration(tree, '@proj/test');
    expect(targets.lint).toEqual({ executor: 'nx:noop' });
    expect(targets.format).toEqual({ executor: 'nx:noop' });
  });
});
