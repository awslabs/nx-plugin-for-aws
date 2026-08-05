/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as devkit from '@nx/devkit';
import { readJson, type Tree } from '@nx/devkit';
import yaml from 'js-yaml';
import { registerBuiltDependencies } from './pnpm-workspace';
import { createTreeUsingTsSolutionSetup } from './test';

vi.mock('@nx/devkit', async (importOriginal) => {
  const original = await importOriginal<typeof devkit>();
  return {
    ...original,
    detectPackageManager: vi.fn(original.detectPackageManager),
  };
});

/**
 * pnpm and bun each refuse a dependency's install scripts unless it is
 * allowlisted, and each keeps that list somewhere different. A package that
 * fetches its own binary in a `preinstall` — `mise` does — is otherwise installed
 * with no binary at all, which surfaces only when a build target runs it.
 *
 * Bun is the case worth pinning down: it fails *silently*, where pnpm at least
 * errors the install.
 */
describe('registerBuiltDependencies', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    vi.mocked(devkit.detectPackageManager).mockReset();
  });

  /**
   * Make the workspace look like the given package manager's. `pnpm` is detected
   * from the tree marker; the others come from `detectPackageManager`, which reads
   * the real filesystem and so has to be stood in for.
   */
  const asPackageManager = (pm: 'pnpm' | 'bun' | 'npm') => {
    if (pm !== 'pnpm') {
      tree.delete('pnpm-workspace.yaml');
    }
    vi.mocked(devkit.detectPackageManager).mockReturnValue(
      pm as devkit.PackageManager,
    );
  };

  it('should record a pnpm workspace allowlist', () => {
    asPackageManager('pnpm');

    registerBuiltDependencies(tree, { mise: true });

    const workspace = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8')!,
    ) as Record<string, any>;
    expect(workspace.allowBuilds.mise).toBe(true);
    expect(workspace.onlyBuiltDependencies).toContain('mise');
  });

  it('should trust the dependency on bun', () => {
    asPackageManager('bun');

    registerBuiltDependencies(tree, { mise: true });

    expect(readJson(tree, 'package.json').trustedDependencies).toContain(
      'mise',
    );
  });

  it('should keep dependencies bun already trusts', () => {
    asPackageManager('bun');
    tree.write(
      'package.json',
      JSON.stringify({ name: 'w', trustedDependencies: ['theirs'] }),
    );

    registerBuiltDependencies(tree, { mise: true });

    expect(readJson(tree, 'package.json').trustedDependencies).toEqual([
      'mise',
      'theirs',
    ]);
  });

  // Bun's allowlist has no equivalent of pnpm's "reviewed but don't build".
  it('should not trust a dependency recorded as not built', () => {
    asPackageManager('bun');

    registerBuiltDependencies(tree, { prisma: false });

    expect(readJson(tree, 'package.json').trustedDependencies).toBeUndefined();
  });

  it('should be idempotent on bun', () => {
    asPackageManager('bun');

    registerBuiltDependencies(tree, { mise: true });
    const afterFirst = tree.read('package.json', 'utf-8');
    registerBuiltDependencies(tree, { mise: true });

    expect(tree.read('package.json', 'utf-8')).toEqual(afterFirst);
  });

  // npm and yarn run install scripts, so there is no list to keep.
  it('should leave an npm workspace alone', () => {
    asPackageManager('npm');
    const before = tree.read('package.json', 'utf-8');

    registerBuiltDependencies(tree, { mise: true });

    expect(tree.read('package.json', 'utf-8')).toEqual(before);
    expect(tree.exists('pnpm-workspace.yaml')).toBeFalsy();
  });
});
