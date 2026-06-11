/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectTypeScriptToCompile } from '../../utils/test/ts.spec';
import tsProjectGenerator from './generator';
import { configureVitest } from './vitest';

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
      skipInstall: true,
    });
  });

  it('should configure vitest to pass with no tests', async () => {
    await configureVitest(tree, {
      dir: 'test',
      fullyQualifiedName: 'test',
    });
    const content = tree.read('test/vitest.config.mts', 'utf8');
    expect(content).toContain('passWithNoTests: true');
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

      await configureVitest(tree, {
        dir: 'test',
        fullyQualifiedName: 'test',
      });

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

    await configureVitest(tree, {
      dir: 'test',
      fullyQualifiedName: 'test',
    });

    const content = tree.read('test/vitest.config.mts', 'utf8')!;
    expect(content.match(/passWithNoTests/g)).toHaveLength(1);
    expectTypeScriptToCompile(tree, ['test/vitest.config.mts']);
  });
});
