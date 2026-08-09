/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

const CONFIG = 'apps/test-project/rolldown.config.ts';

/**
 * A `rolldown.config.ts` as an older release generated it, with two bundle
 * entries. Hardcoded rather than produced by the bundle helper: a migration has
 * to keep applying to the shape that shipped, however far the generator's output
 * moves afterwards.
 */
const OLD_CONFIG = `import { defineConfig } from 'rolldown';

export default defineConfig([
  {
    tsconfig: 'tsconfig.lib.json',
    input: 'src/index.ts',
    output: {
      file: '../../dist/apps/test-project/bundle/index.js',
      format: 'cjs',
      inlineDynamicImports: true,
    },
    platform: 'node',
  },
  {
    tsconfig: 'tsconfig.lib.json',
    input: 'src/handler.ts',
    output: {
      file: '../../dist/apps/test-project/bundle/handler/index.js',
      format: 'cjs',
      inlineDynamicImports: true,
    },
    platform: 'node',
    external: [/@aws-sdk\\/.*/],
  },
]);
`;

const read = (tree: Tree, path: string): string =>
  tree.read(path, 'utf-8') ?? '';

const givenConfig = (tree: Tree, contents: string): void => {
  addProjectConfiguration(tree, 'test-project', {
    root: 'apps/test-project',
    sourceRoot: 'apps/test-project/src',
  });
  tree.write(CONFIG, contents);
};

describe('rolldown-code-splitting migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should rewrite every entry an older release generated', async () => {
    givenConfig(tree, OLD_CONFIG);

    await migration(tree);

    const config = read(tree, CONFIG);
    expect(config).not.toContain('inlineDynamicImports');
    // Both bundle entries, so the option is rewritten wherever it appears.
    expect(config.match(/codeSplitting: false/g)).toHaveLength(2);
  });

  it('should drop the deprecated option where codeSplitting is already set', async () => {
    givenConfig(
      tree,
      OLD_CONFIG.replaceAll(
        'inlineDynamicImports: true,',
        'inlineDynamicImports: true,\n      codeSplitting: false,',
      ),
    );

    await migration(tree);

    const config = read(tree, CONFIG);
    // Renaming rather than dropping would leave the key in twice.
    expect(config).not.toContain('inlineDynamicImports');
    expect(config.match(/codeSplitting: false/g)).toHaveLength(2);
  });

  it('should leave inlineDynamicImports: false alone', async () => {
    // The opposite request — a user who set this deliberately keeps it.
    givenConfig(
      tree,
      OLD_CONFIG.replaceAll(
        'inlineDynamicImports: true',
        'inlineDynamicImports: false',
      ),
    );

    await migration(tree);

    const config = read(tree, CONFIG);
    expect(config).toContain('inlineDynamicImports: false');
    expect(config).not.toContain('codeSplitting');
  });

  it('should leave an object of the user own that carries the same key alone', async () => {
    givenConfig(
      tree,
      `const buildOptions = { inlineDynamicImports: true };\n${OLD_CONFIG.replaceAll(
        '      inlineDynamicImports: true,\n',
        '',
      )}`,
    );

    await migration(tree);

    // Only a rolldown `output` block is rewritten.
    expect(read(tree, CONFIG)).toContain(
      'const buildOptions = { inlineDynamicImports: true }',
    );
  });

  it('should not produce a doubled comma', async () => {
    givenConfig(tree, OLD_CONFIG);

    await migration(tree);

    expect(read(tree, CONFIG)).not.toMatch(/,\s*,/);
  });

  it('should be idempotent', async () => {
    givenConfig(tree, OLD_CONFIG);

    await migration(tree);
    const afterFirst = read(tree, CONFIG);
    await migration(tree);

    expect(read(tree, CONFIG)).toBe(afterFirst);
  });
});
