/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import tsProjectGenerator from './generator';
import { configureVitest } from './vitest';

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
});
