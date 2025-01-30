/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import tsLibGenerator from './generator';
import { configureVitest } from './vitest';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
describe('vitest utils', () => {
  let tree: Tree;
  beforeEach(async () => {
    tree = createTreeUsingTsSolutionSetup();
    await tsLibGenerator(tree, {
      name: 'test',
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
