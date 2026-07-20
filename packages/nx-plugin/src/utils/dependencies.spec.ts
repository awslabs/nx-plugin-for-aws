/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as devkit from '@nx/devkit';
import { readJson, type Tree } from '@nx/devkit';
import yaml from 'js-yaml';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addDependenciesToPackageJson,
  resetCatalogSupportCache,
} from './dependencies';
import { createTreeUsingTsSolutionSetup } from './test';

vi.mock('@nx/devkit', async (importOriginal) => {
  const original = await importOriginal<typeof devkit>();
  return {
    ...original,
    detectPackageManager: vi.fn(original.detectPackageManager),
    getPackageManagerVersion: vi.fn(original.getPackageManagerVersion),
  };
});

// The tree marker (pnpm-workspace.yaml) takes precedence over
// detectPackageManager, so non-pnpm cases must also remove it.
const mockPackageManager = (tree: Tree, pm: string, version: string) => {
  if (pm !== 'pnpm' && tree.exists('pnpm-workspace.yaml')) {
    tree.delete('pnpm-workspace.yaml');
  }
  vi.mocked(devkit.detectPackageManager).mockReturnValue(
    pm as devkit.PackageManager,
  );
  vi.mocked(devkit.getPackageManagerVersion).mockReturnValue(version);
};

describe('addDependenciesToPackageJson', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    vi.mocked(devkit.detectPackageManager).mockReset();
    vi.mocked(devkit.getPackageManagerVersion).mockReset();
    resetCatalogSupportCache();
  });

  it('should write catalog references and record versions in pnpm-workspace.yaml for pnpm', () => {
    mockPackageManager(tree, 'pnpm', '10.0.0');

    addDependenciesToPackageJson(tree, { zod: '4.4.3' }, { tsx: '4.20.0' });

    const packageJson = readJson(tree, 'package.json');
    expect(packageJson.dependencies.zod).toBe('catalog:');
    expect(packageJson.devDependencies.tsx).toBe('catalog:');

    const workspaceYaml = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8'),
    ) as any;
    expect(workspaceYaml.catalog.zod).toBe('4.4.3');
    expect(workspaceYaml.catalog.tsx).toBe('4.20.0');
  });

  it('should record versions in .yarnrc.yml for yarn', () => {
    mockPackageManager(tree, 'yarn', '4.10.0');

    addDependenciesToPackageJson(tree, { zod: '4.4.3' }, {});

    expect(readJson(tree, 'package.json').dependencies.zod).toBe('catalog:');
    const yarnRc = yaml.load(tree.read('.yarnrc.yml', 'utf-8')) as any;
    expect(yarnRc.catalog.zod).toBe('4.4.3');
  });

  it('should record versions in the root package.json catalog field for bun', () => {
    mockPackageManager(tree, 'bun', '1.3.0');

    addDependenciesToPackageJson(tree, { zod: '4.4.3' }, {});

    const packageJson = readJson(tree, 'package.json');
    expect(packageJson.dependencies.zod).toBe('catalog:');
    expect(packageJson.catalog.zod).toBe('4.4.3');
  });

  it('should write direct version ranges for npm', () => {
    mockPackageManager(tree, 'npm', '11.0.0');

    addDependenciesToPackageJson(tree, { zod: '4.4.3' }, {});

    const packageJson = readJson(tree, 'package.json');
    expect(packageJson.dependencies.zod).toBe('4.4.3');
    expect(packageJson.catalog).toBeUndefined();
  });

  it('should write direct version ranges when the package manager version predates catalogs', () => {
    mockPackageManager(tree, 'pnpm', '9.4.0');

    addDependenciesToPackageJson(tree, { zod: '4.4.3' }, {});

    expect(readJson(tree, 'package.json').dependencies.zod).toBe('4.4.3');
  });

  it('should write catalog references to non-root package.json files and record the version in the workspace catalog', () => {
    mockPackageManager(tree, 'pnpm', '10.0.0');
    tree.write(
      'packages/plugin/package.json',
      JSON.stringify({ name: '@proj/plugin' }),
    );

    addDependenciesToPackageJson(
      tree,
      { zod: '4.4.3' },
      {},
      'packages/plugin/package.json',
    );

    expect(
      readJson(tree, 'packages/plugin/package.json').dependencies.zod,
    ).toBe('catalog:');
    const workspaceYaml = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8'),
    ) as any;
    expect(workspaceYaml.catalog.zod).toBe('4.4.3');
  });

  it('should route build/test tooling to the root while runtime deps stay in the project manifest', () => {
    mockPackageManager(tree, 'pnpm', '10.0.0');
    tree.write(
      'packages/lib/package.json',
      JSON.stringify({ name: '@proj/lib' }),
    );

    addDependenciesToPackageJson(
      tree,
      { zod: '4.4.3' },
      { tsx: '4.20.0', '@types/aws-lambda': '8.10.0' },
      'packages/lib/package.json',
    );

    const projectPkg = readJson(tree, 'packages/lib/package.json');
    // Runtime dep and its type stub stay in the project.
    expect(projectPkg.dependencies.zod).toBe('catalog:');
    expect(projectPkg.devDependencies['@types/aws-lambda']).toBe('catalog:');
    expect(projectPkg.devDependencies?.tsx).toBeUndefined();
    // Pure tooling is redirected to the workspace root.
    const rootPkg = readJson(tree, 'package.json');
    expect(rootPkg.devDependencies.tsx).toBe('catalog:');
    expect(rootPkg.dependencies?.zod).toBeUndefined();
  });

  it('should write direct version ranges to non-root package.json files on npm', () => {
    mockPackageManager(tree, 'npm', '11.0.0');
    tree.write(
      'packages/plugin/package.json',
      JSON.stringify({ name: '@proj/plugin' }),
    );

    addDependenciesToPackageJson(
      tree,
      { zod: '4.4.3' },
      {},
      'packages/plugin/package.json',
    );

    expect(
      readJson(tree, 'packages/plugin/package.json').dependencies.zod,
    ).toBe('4.4.3');
  });

  it('should update the catalog version for dependencies already using catalog references', () => {
    mockPackageManager(tree, 'pnpm', '10.0.0');
    addDependenciesToPackageJson(tree, { zod: '4.4.2' }, {});

    addDependenciesToPackageJson(tree, { zod: '4.4.3' }, {});

    expect(readJson(tree, 'package.json').dependencies.zod).toBe('catalog:');
    const workspaceYaml = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8'),
    ) as any;
    expect(workspaceYaml.catalog.zod).toBe('4.4.3');
  });

  it('should not downgrade a user-upgraded catalog version when adding to another project', () => {
    mockPackageManager(tree, 'pnpm', '10.0.0');
    // The user has raised zod in the catalog beyond the plugin-pinned version.
    tree.write(
      'pnpm-workspace.yaml',
      yaml.dump({ packages: ['packages/*'], catalog: { zod: '9.9.9' } }),
    );
    tree.write(
      'packages/fresh/package.json',
      JSON.stringify({ name: '@proj/fresh' }),
    );

    addDependenciesToPackageJson(
      tree,
      { zod: '4.4.3' },
      {},
      'packages/fresh/package.json',
    );

    // The new project references the catalog, and the catalog keeps the
    // user's version — every project referencing it stays on 9.9.9.
    expect(readJson(tree, 'packages/fresh/package.json').dependencies.zod).toBe(
      'catalog:',
    );
    const workspaceYaml = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8'),
    ) as any;
    expect(workspaceYaml.catalog.zod).toBe('9.9.9');
  });

  it('should upgrade a catalog version lower than the incoming one', () => {
    mockPackageManager(tree, 'pnpm', '10.0.0');
    tree.write(
      'pnpm-workspace.yaml',
      yaml.dump({ packages: ['packages/*'], catalog: { zod: '4.4.2' } }),
    );
    tree.write(
      'packages/fresh/package.json',
      JSON.stringify({ name: '@proj/fresh' }),
    );

    addDependenciesToPackageJson(
      tree,
      { zod: '4.4.3' },
      {},
      'packages/fresh/package.json',
    );

    const workspaceYaml = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8'),
    ) as any;
    expect(workspaceYaml.catalog.zod).toBe('4.4.3');
  });

  it('should keep a user-customised catalog entry that is not a plain version', () => {
    mockPackageManager(tree, 'pnpm', '10.0.0');
    tree.write(
      'pnpm-workspace.yaml',
      yaml.dump({ packages: ['packages/*'], catalog: { zod: 'next' } }),
    );
    tree.write(
      'packages/fresh/package.json',
      JSON.stringify({ name: '@proj/fresh' }),
    );

    addDependenciesToPackageJson(
      tree,
      { zod: '4.4.3' },
      {},
      'packages/fresh/package.json',
    );

    const workspaceYaml = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8'),
    ) as any;
    expect(workspaceYaml.catalog.zod).toBe('next');
  });

  it('should catalog vite and vitest (nx#35453 resolves catalog: refs in version lookups)', () => {
    mockPackageManager(tree, 'pnpm', '10.0.0');

    addDependenciesToPackageJson(tree, {}, { vite: '8.1.4', vitest: '4.1.10' });

    const packageJson = readJson(tree, 'package.json');
    expect(packageJson.devDependencies.vite).toBe('catalog:');
    expect(packageJson.devDependencies.vitest).toBe('catalog:');
    const workspaceYaml = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8'),
    ) as any;
    expect(workspaceYaml.catalog.vite).toBe('8.1.4');
    expect(workspaceYaml.catalog.vitest).toBe('4.1.10');
  });

  it('should write direct version ranges when catalogs are disabled via config', () => {
    mockPackageManager(tree, 'pnpm', '10.0.0');
    // Opt out of catalogs in the plugin config.
    tree.write(
      'aws-nx-plugin.config.mts',
      [
        "import { AwsNxPluginConfig } from '@aws/nx-plugin';",
        '',
        'export default {',
        '  packageManager: { catalogs: false },',
        '} satisfies AwsNxPluginConfig;',
        '',
      ].join('\n'),
    );
    tree.write(
      'packages/lib/package.json',
      JSON.stringify({ name: '@proj/lib' }),
    );

    addDependenciesToPackageJson(
      tree,
      { zod: '4.4.3' },
      {},
      'packages/lib/package.json',
    );

    // Version is written directly to the project manifest; no catalog entry.
    expect(readJson(tree, 'packages/lib/package.json').dependencies.zod).toBe(
      '4.4.3',
    );
    const workspaceYaml = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8'),
    ) as any;
    expect(workspaceYaml.catalog).toBeUndefined();
  });

  it('should still use catalogs when the config enables them explicitly', () => {
    mockPackageManager(tree, 'pnpm', '10.0.0');
    tree.write(
      'aws-nx-plugin.config.mts',
      [
        "import { AwsNxPluginConfig } from '@aws/nx-plugin';",
        '',
        'export default {',
        '  packageManager: { catalogs: true },',
        '} satisfies AwsNxPluginConfig;',
        '',
      ].join('\n'),
    );

    addDependenciesToPackageJson(tree, { zod: '4.4.3' }, {});

    expect(readJson(tree, 'package.json').dependencies.zod).toBe('catalog:');
    const workspaceYaml = yaml.load(
      tree.read('pnpm-workspace.yaml', 'utf-8'),
    ) as any;
    expect(workspaceYaml.catalog.zod).toBe('4.4.3');
  });

  it('should be idempotent when re-run with the same dependencies', () => {
    mockPackageManager(tree, 'pnpm', '10.0.0');
    addDependenciesToPackageJson(tree, { zod: '4.4.3' }, {});
    const packageJsonBefore = tree.read('package.json', 'utf-8');
    const workspaceYamlBefore = tree.read('pnpm-workspace.yaml', 'utf-8');

    addDependenciesToPackageJson(tree, { zod: '4.4.3' }, {});

    expect(tree.read('package.json', 'utf-8')).toEqual(packageJsonBefore);
    expect(tree.read('pnpm-workspace.yaml', 'utf-8')).toEqual(
      workspaceYamlBefore,
    );
  });
});
