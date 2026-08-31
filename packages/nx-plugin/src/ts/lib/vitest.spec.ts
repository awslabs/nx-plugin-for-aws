/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { declareDependencies } from '../../utils/declared-dependencies.js';
import { expectTypeScriptToCompile } from '../../utils/test/ts.spec.js';
import { createTreeUsingTsSolutionSetup } from '../../utils/test.js';
import tsProjectGenerator from './generator.js';
import { configureVitest, VITEST_DEPENDENCIES } from './vitest.js';

const declaration = declareDependencies()({ ts: [...VITEST_DEPENDENCIES] });

// A local defineConfig stub keeps the generated config self-contained so it can
// be type-checked without loading the vite/vitest dependencies. The grit
// transform only requires the test block to be within a `defineConfig(...)`
// call, so this exercises the same code path as a real vite config.
const wrapConfig = (testBlock: string) =>
  `const defineConfig = (fn: () => unknown): unknown => fn();
export default defineConfig(() => ({
  ${testBlock}
}));
`;

describe('vitest utils', () => {
  let tree: Tree;

  beforeEach(async () => {
    tree = createTreeUsingTsSolutionSetup();
    await tsProjectGenerator(tree, {
      name: 'test',
      preferInstallDependencies: false,
    });
  });

  it('should configure vitest to pass with no tests', async () => {
    await configureVitest(
      tree,
      {
        dir: 'test',
        fullyQualifiedName: 'test',
      },
      declaration,
    );
    const content = tree.read('test/vitest.config.mts', 'utf8');
    expect(content).toContain('passWithNoTests: true');
  });

  it('should resolve the config root from import.meta.dirname', async () => {
    await configureVitest(
      tree,
      {
        dir: 'test',
        fullyQualifiedName: 'test',
      },
      declaration,
    );
    const content = tree.read('test/vitest.config.mts', 'utf8');
    // `@nx/js` writes `root: __dirname`, which Vite warns about under
    // `configLoader: 'native'` and will reject once that becomes the default.
    expect(content).toContain('root: import.meta.dirname');
    expect(content).not.toContain('root: __dirname');
  });

  it('should write coverage under the project dist directory', async () => {
    await configureVitest(
      tree,
      {
        dir: 'test',
        fullyQualifiedName: 'test',
      },
      declaration,
    );
    const content = tree.read('test/vitest.config.mts', 'utf8');
    // Coverage inside the project would be formatted by the `format` target and
    // counted as an input to every task in the project.
    expect(content).toContain(
      `reportsDirectory: '../dist/test/test-output/vitest/coverage'`,
    );
    expect(content).not.toContain(`'./test-output`);
  });

  it('should resolve the coverage depth of a nested project', async () => {
    tree.write(
      'packages/nested/lib/vitest.config.mts',
      wrapConfig(`test: {
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },`),
    );

    await configureVitest(
      tree,
      {
        dir: 'packages/nested/lib',
        fullyQualifiedName: '@proj/lib',
      },
      declaration,
    );

    expect(
      tree.read('packages/nested/lib/vitest.config.mts', 'utf8'),
    ).toContain(
      `reportsDirectory: '../../../dist/packages/nested/lib/test-output/vitest/coverage'`,
    );
  });

  it('should leave a coverage directory the user repointed alone', async () => {
    tree.write(
      'test/vitest.config.mts',
      wrapConfig(`test: {
    coverage: {
      reportsDirectory: './my-coverage',
      provider: 'v8' as const,
    },
  },`),
    );

    await configureVitest(
      tree,
      {
        dir: 'test',
        fullyQualifiedName: 'test',
      },
      declaration,
    );

    expect(tree.read('test/vitest.config.mts', 'utf8')).toContain(
      `reportsDirectory: './my-coverage'`,
    );
  });

  it('should generate a valid vitest.config.mts without a double comma', () => {
    const content = tree.read('test/vitest.config.mts', 'utf8');
    // Guards against the grit transform emitting `},,` when the matched
    // properties already end with a trailing comma.
    expect(content).not.toMatch(/,\s*,/);
    expect(content).toMatchSnapshot('vitest.config.mts');
  });

  // The grit transform splices `passWithNoTests` into the existing `test`
  // block. Verify the result still compiles across a variety of test block
  // shapes regardless of trailing commas — a missing comma between properties
  // would not produce a double comma, so it could otherwise slip through.
  it.each([
    {
      name: 'trailing comma on last property',
      testBlock: `test: {
    name: '@proj/test',
    watch: false,
  },`,
    },
    {
      name: 'no trailing comma on last property',
      testBlock: `test: {
    name: '@proj/test',
    watch: false
  },`,
    },
    {
      name: 'single line test block',
      testBlock: `test: { globals: true },`,
    },
    {
      name: 'empty test block',
      testBlock: `test: {},`,
    },
  ])(
    'should add passWithNoTests producing compilable config: $name',
    async ({ testBlock }) => {
      tree.write('test/vitest.config.mts', wrapConfig(testBlock));

      await configureVitest(
        tree,
        {
          dir: 'test',
          fullyQualifiedName: 'test',
        },
        declaration,
      );

      const content = tree.read('test/vitest.config.mts', 'utf8')!;
      expect(content).toContain('passWithNoTests: true');
      expectTypeScriptToCompile(tree, ['test/vitest.config.mts']);
    },
  );

  it('should not add passWithNoTests when it is already present', async () => {
    tree.write(
      'test/vitest.config.mts',
      wrapConfig(`test: {
    passWithNoTests: true,
    name: '@proj/test',
  },`),
    );

    await configureVitest(
      tree,
      {
        dir: 'test',
        fullyQualifiedName: 'test',
      },
      declaration,
    );

    const content = tree.read('test/vitest.config.mts', 'utf8')!;
    expect(content.match(/passWithNoTests/g)).toHaveLength(1);
    expectTypeScriptToCompile(tree, ['test/vitest.config.mts']);
  });
});
