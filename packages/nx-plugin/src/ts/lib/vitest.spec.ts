/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { createTreeWithEmptyWorkspace } from 'nx/src/devkit-testing-exports';
import tsLibGenerator from './generator';
import { configureVitest } from './vitest';
describe('vitest utils', () => {
  let tree: Tree;
  beforeEach(async () => {
    tree = createTreeWithEmptyWorkspace();
    await tsLibGenerator(tree, {
      name: 'test',
      unitTestRunner: 'vitest',
      skipInstall: true,
    });
  });
  it('should configure vitest to pass with no tests', () => {
    configureVitest(tree, {
      dir: 'test',
      fullyQualifiedName: 'test',
    });
    const content = tree.read('test/vite.config.ts', 'utf8');
    expect(content).toContain('passWithNoTests: true');
  });
});
