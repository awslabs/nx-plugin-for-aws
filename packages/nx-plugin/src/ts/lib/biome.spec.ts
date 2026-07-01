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

  it('should make the lint target a no-op when there is no root biome.json', async () => {
    tree.delete('biome.json');
    await configureBiomeLint(tree, {
      dir: 'test',
      fullyQualifiedName: '@proj/test',
    });
    const { targets } = readProjectConfiguration(tree, '@proj/test');
    expect(targets.lint).toEqual({ executor: 'nx:noop' });
  });
});
