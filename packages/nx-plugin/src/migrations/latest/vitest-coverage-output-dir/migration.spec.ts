/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, readJson, type Tree } from '@nx/devkit';
import { getDefaultBiomeConfig } from '../../../utils/format.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const LIB_CONFIG = 'packages/lib/vitest.config.mts';
const WEBSITE_CONFIG = 'packages/website/vite.config.mts';

/**
 * A library's `vitest.config.mts` as an older release generated it. Hardcoded
 * rather than produced by the generator: a migration has to keep applying to the
 * shape that shipped, however far the generator's output moves afterwards.
 */
const OLD_LIB_CONFIG = `import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/lib',
  test: {
    passWithNoTests: true,
    name: '@proj/lib',
    watch: false,
    globals: true,
    environment: 'jsdom',
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
`;

const read = (tree: Tree, path: string): string =>
  tree.read(path, 'utf-8') ?? '';

/**
 * Read a config with whitespace collapsed. Biome wraps the long
 * `reportsDirectory` lines the migration writes, so assertions match on the
 * value rather than on where the line happens to break.
 */
const readCollapsed = (tree: Tree, path: string): string =>
  read(tree, path).replace(/\s+/g, ' ');

/** Register a project and write the given vitest config into it. */
const givenProject = (
  tree: Tree,
  name: string,
  config: string,
  configFile = 'vitest.config.mts',
): void => {
  const root = `packages/${name}`;
  addProjectConfiguration(tree, `@proj/${name}`, {
    root,
    sourceRoot: `${root}/src`,
  });
  tree.write(`${root}/${configFile}`, config);
};

describe('vitest-coverage-output-dir migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    tree.write(
      'biome.json',
      JSON.stringify(getDefaultBiomeConfig(tree), null, 2),
    );
  });

  it('should point the generated coverage directory at dist', async () => {
    givenProject(tree, 'lib', OLD_LIB_CONFIG);

    const result = await migration(tree);

    expect(read(tree, LIB_CONFIG)).toContain(
      `reportsDirectory: '../../dist/packages/lib/test-output/vitest/coverage'`,
    );
    expect(read(tree, LIB_CONFIG)).not.toContain(`'./test-output`);
    expect(result.nextSteps).toEqual([]);
  });

  it('should resolve the depth of a nested project root', async () => {
    const root = 'packages/nested/lib';
    addProjectConfiguration(tree, '@proj/nested-lib', { root });
    tree.write(`${root}/vitest.config.mts`, OLD_LIB_CONFIG);

    await migration(tree);

    expect(readCollapsed(tree, `${root}/vitest.config.mts`)).toContain(
      `reportsDirectory: '../../../dist/packages/nested/lib/test-output/vitest/coverage'`,
    );
  });

  it('should migrate a website vite.config.mts', async () => {
    givenProject(tree, 'website', OLD_LIB_CONFIG, 'vite.config.mts');

    await migration(tree);

    expect(readCollapsed(tree, WEBSITE_CONFIG)).toContain(
      `reportsDirectory: '../../dist/packages/website/test-output/vitest/coverage'`,
    );
  });

  it('should exclude test-output from biome', async () => {
    givenProject(tree, 'lib', OLD_LIB_CONFIG);

    await migration(tree);

    const includes = readJson(tree, 'biome.json').files.includes;
    expect(includes).toContain('!**/test-output');
    // Kept alongside the other build-output excludes.
    expect(includes.indexOf('!**/test-output')).toBe(
      includes.indexOf('!**/out-tsc') + 1,
    );
  });

  it('should leave a coverage directory the user repointed alone', async () => {
    givenProject(
      tree,
      'lib',
      OLD_LIB_CONFIG.replace(
        `'./test-output/vitest/coverage'`,
        `'./my-coverage'`,
      ),
    );

    const result = await migration(tree);

    expect(read(tree, LIB_CONFIG)).toContain(
      `reportsDirectory: './my-coverage'`,
    );
    expect(result.nextSteps).toHaveLength(1);
    expect(result.nextSteps[0]).toContain(LIB_CONFIG);
    expect(result.nextSteps[0]).toContain('@proj/lib');
  });

  it('should leave a reportsDirectory outside the config alone', async () => {
    givenProject(
      tree,
      'lib',
      `const other = { coverage: { reportsDirectory: './test-output/vitest/coverage' } };\n${OLD_LIB_CONFIG}`,
    );

    await migration(tree);

    const config = readCollapsed(tree, LIB_CONFIG);
    expect(config).toContain(
      `const other = { coverage: { reportsDirectory: './test-output/vitest/coverage' }`,
    );
    expect(config).toContain(
      `reportsDirectory: '../../dist/packages/lib/test-output/vitest/coverage'`,
    );
  });

  it('should leave a config without a coverage block alone', async () => {
    const withoutCoverage = `import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  test: {
    passWithNoTests: true,
    name: '@proj/lib',
  },
}));
`;
    givenProject(tree, 'lib', withoutCoverage);

    const result = await migration(tree);

    expect(read(tree, LIB_CONFIG)).toBe(withoutCoverage);
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a workspace with no projects alone', async () => {
    const result = await migration(tree);

    expect(result.nextSteps).toEqual([]);
  });

  it('should preserve a biome files.includes the workspace has rewritten', async () => {
    givenProject(tree, 'lib', OLD_LIB_CONFIG);
    tree.write('biome.json', JSON.stringify({ files: { includes: ['**'] } }));

    await migration(tree);

    expect(readJson(tree, 'biome.json').files.includes).toEqual(['**']);
  });

  it('should be idempotent', async () => {
    givenProject(tree, 'lib', OLD_LIB_CONFIG);
    givenProject(
      tree,
      'custom',
      OLD_LIB_CONFIG.replace(
        `'./test-output/vitest/coverage'`,
        `'./my-coverage'`,
      ),
    );

    const first = await migration(tree);
    const afterFirst = [
      read(tree, LIB_CONFIG),
      read(tree, 'packages/custom/vitest.config.mts'),
      read(tree, 'biome.json'),
    ];

    const second = await migration(tree);

    expect([
      read(tree, LIB_CONFIG),
      read(tree, 'packages/custom/vitest.config.mts'),
      read(tree, 'biome.json'),
    ]).toEqual(afterFirst);
    expect(second.nextSteps).toEqual(first.nextSteps);
  });
});
