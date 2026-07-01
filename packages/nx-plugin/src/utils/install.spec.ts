/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as devkit from '@nx/devkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDependencies } from './install';

const install = vi.fn();

vi.mock('@nx/devkit', async () => {
  const actual = await vi.importActual('@nx/devkit');
  return {
    ...actual,
    installPackagesTask: vi.fn(),
  };
});

vi.mock('./nxlv-python', () => ({
  UVProvider: class {
    install = install;
  },
  Logger: class {},
}));

/**
 * Creates a real on-disk workspace directory (the resolvability check reads the
 * filesystem) and returns a minimal tree-like object pointing at it.
 */
const createWorkspace = (installedPackages: string[] = []) => {
  const root = mkdtempSync(join(tmpdir(), 'install-spec-'));
  for (const pkg of installedPackages) {
    const dir = join(root, 'node_modules', pkg);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: pkg, version: '1.0.0' }),
    );
  }
  return { root } as devkit.Tree;
};

describe('installDependencies', () => {
  const cleanups: string[] = [];
  const workspace = (installedPackages: string[] = []) => {
    const tree = createWorkspace(installedPackages);
    cleanups.push(tree.root);
    return tree;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    for (const root of cleanups.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('installs typescript dependencies', async () => {
    await installDependencies(workspace(['vitest']), true, {
      languages: ['typescript'],
    });
    expect(devkit.installPackagesTask).toHaveBeenCalledOnce();
    expect(install).not.toHaveBeenCalled();
  });

  it('installs python dependencies', async () => {
    await installDependencies(workspace(), true, { languages: ['python'] });
    expect(install).toHaveBeenCalledOnce();
    expect(devkit.installPackagesTask).not.toHaveBeenCalled();
  });

  it('installs both typescript and python dependencies', async () => {
    await installDependencies(workspace(['vitest']), true, {
      languages: ['typescript', 'python'],
    });
    expect(devkit.installPackagesTask).toHaveBeenCalledOnce();
    expect(install).toHaveBeenCalledOnce();
  });

  it('installs by default when the preference is undefined', async () => {
    await installDependencies(workspace(['vitest']), undefined, {
      languages: ['typescript'],
    });
    expect(devkit.installPackagesTask).toHaveBeenCalledOnce();
  });

  it('defers when preferInstallDependencies is false and graph deps are installed', async () => {
    // vitest is implied for typescript and is present in the workspace.
    await installDependencies(workspace(['vitest']), false, {
      languages: ['typescript'],
    });
    expect(devkit.installPackagesTask).not.toHaveBeenCalled();
  });

  it('installs despite the defer preference when a graph dep is missing', async () => {
    // `@nxlv/python` (implied for python) is not installed, so the install must
    // run regardless of the defer preference. Use a scoped name that cannot
    // exist in any ancestor node_modules so the assertion is deterministic.
    await installDependencies(workspace(), false, { languages: ['python'] });
    expect(install).toHaveBeenCalledOnce();
  });

  it('installs despite the defer preference when an extra ensureResolvable package is missing', async () => {
    await installDependencies(workspace(['vitest']), false, {
      languages: ['typescript'],
      ensureResolvable: ['@tailwindcss/vite'],
    });
    expect(devkit.installPackagesTask).toHaveBeenCalledOnce();
  });

  it('defers when all extra ensureResolvable packages are installed', async () => {
    await installDependencies(
      workspace(['vitest', '@tailwindcss/vite']),
      false,
      {
        languages: ['typescript'],
        ensureResolvable: ['@tailwindcss/vite'],
      },
    );
    expect(devkit.installPackagesTask).not.toHaveBeenCalled();
  });

  it('does not count a package linked only in an ancestor node_modules', async () => {
    // The package is installed in the parent but not the workspace itself. Nx
    // loads a project's config from inside the workspace's own node_modules, so
    // an ancestor copy is not usable — the install must still run. (This is why
    // we check the path directly rather than via `require.resolve`, which would
    // walk up and wrongly report the ancestor copy as resolvable.)
    const parent = workspace(['vitest']);
    const child = join(parent.root, 'child');
    mkdirSync(child, { recursive: true });
    await installDependencies({ root: child } as devkit.Tree, false, {
      languages: ['typescript'],
    });
    expect(devkit.installPackagesTask).toHaveBeenCalledOnce();
  });

  it('counts an installed package whose `exports` map hides package.json', async () => {
    // Packages like `@tailwindcss/vite` define `exports` without `./package.json`,
    // so `require.resolve('<pkg>/package.json')` throws even though the package
    // is installed. The direct path check must treat it as present and defer,
    // otherwise we would force a redundant install on every run.
    const tree = workspace(['vitest']);
    const dir = join(tree.root, 'node_modules', '@tailwindcss/vite');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: '@tailwindcss/vite',
        version: '1.0.0',
        exports: { '.': './dist/index.mjs' },
      }),
    );
    await installDependencies(tree, false, {
      languages: ['typescript'],
      ensureResolvable: ['@tailwindcss/vite'],
    });
    expect(devkit.installPackagesTask).not.toHaveBeenCalled();
  });
});
