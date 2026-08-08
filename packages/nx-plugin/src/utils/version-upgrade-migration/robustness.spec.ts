/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree, writeJson } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../test';
import { BASE_IMAGES, TS_VERSIONS } from '../versions';
import { syncVendedVersions } from './sync-vended-versions';

// A thrown migration aborts the whole `nx migrate`, stranding the user mid
// upgrade. These files are the user's to hand-edit, so the sync's contract —
// only touch what it owns, leave everything else exactly as it is — has to hold
// for malformed input too: skip it, never crash the run.
describe('malformed input', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'agent', {
      root: 'packages/agent',
      metadata: { generator: 'ts#agent', iac: 'cdk' } as never,
    });
  });

  // `minimatch` and `npm` are owned for their Dockerfile pins, so a manifest
  // version for them now reaches the specifier check that assumed a string.
  it.each([
    ['a number', 123],
    ['null', null],
    ['a boolean', true],
    ['an object', { version: '1.0.0' }],
  ])('should skip a dependency whose version is %s', async (_, version) => {
    writeJson(tree, 'packages/agent/package.json', {
      name: '@proj/agent',
      dependencies: { minimatch: version },
    });

    await expect(syncVendedVersions(tree)).resolves.toBeDefined();
    // Left exactly as the user wrote it.
    expect(
      (tree.read('packages/agent/package.json', 'utf-8') ?? '').includes(
        TS_VERSIONS.minimatch,
      ),
    ).toBe(false);
  });

  // A pin repeated more times than one rewrite handles is reported rather than
  // rewritten, since the rewrite cost grows with the number of occurrences.
  it('should report a Dockerfile repeating a pin too many times', async () => {
    const lines = [`FROM ${BASE_IMAGES.node}`];
    for (let i = 0; i < 300; i += 1) {
      lines.push('RUN npm install -g npm@11.0.0');
    }
    tree.write('packages/agent/Dockerfile', lines.join('\n'));

    const { nextSteps } = await syncVendedVersions(tree);

    expect(tree.read('packages/agent/Dockerfile', 'utf-8')).toContain(
      'npm@11.0.0',
    );
    expect(nextSteps).toContainEqual(
      expect.stringContaining('packages/agent/Dockerfile'),
    );
  });
});
