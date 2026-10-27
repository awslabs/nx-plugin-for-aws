/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../utils/test.js';
import { normalizeComponent } from './common.js';
import { greengrassComponentGenerator } from './generator.js';
import schema from './schema.json' with { type: 'json' };

/**
 * A host with both a `tsconfig.json` and a `pyproject.toml`, so a python and a
 * typescript component can each be generated on it by explicit `--language`.
 */
const seedBothLanguageHost = (tree: Tree) => {
  addProjectConfiguration(tree, 'both-host', {
    name: 'both-host',
    root: 'apps/both-host',
    sourceRoot: 'apps/both-host/src',
    targets: { compile: { executor: '@nx/js:tsc' } },
  });
  tree.write('apps/both-host/tsconfig.json', '{}');
  tree.write(
    'apps/both-host/package.json',
    JSON.stringify({ name: '@proj/both-host', type: 'module' }),
  );
  tree.write('apps/both-host/src/index.ts', 'export {};');
  tree.write(
    'apps/both-host/pyproject.toml',
    '[project]\nname = "both_host"\nversion = "0.1.0"\ndependencies = []\n',
  );
};

describe('greengrassComponentGenerator preflight', () => {
  it('rejects an inferred TypeScript host without a source root before writes', async () => {
    const tree = await createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'host', { root: 'apps/host' });
    tree.write('apps/host/tsconfig.json', '{}');

    const before = tree.listChanges();
    await expect(
      greengrassComponentGenerator(tree, { project: 'host', name: 'pulse' }),
    ).rejects.toThrow('source root');
    expect(tree.listChanges()).toEqual(before);
  });

  it('allows existing language-specific Greengrass metadata', async () => {
    const tree = await createTreeUsingTsSolutionSetup();
    const legacyMetadata = {
      generator: 'ts#greengrass-component',
      name: 'pulse',
      path: 'src/greengrass/pulse/main.ts',
    };
    addProjectConfiguration(tree, 'host', {
      root: 'apps/host',
      sourceRoot: 'apps/host/src',
      metadata: {
        components: [legacyMetadata],
      },
    });
    tree.write('apps/host/tsconfig.json', '{}');
    tree.write(
      'apps/host/package.json',
      JSON.stringify({ name: '@proj/host' }),
    );
    tree.write('apps/host/src/index.ts', 'export {};');

    await expect(
      greengrassComponentGenerator(tree, {
        project: 'host',
        name: 'next',
        language: 'typescript',
        infra: 'none',
      }),
    ).resolves.toBeDefined();

    const { metadata } = JSON.parse(
      tree.read('apps/host/project.json', 'utf-8'),
    );
    expect(metadata.components).toContainEqual(legacyMetadata);
    expect(metadata.components).toContainEqual(
      expect.objectContaining({
        generator: 'greengrass#component',
        name: 'next',
        language: 'typescript',
      }),
    );
  });

  it('resolves every marker combination without writing', async () => {
    const tree = await createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'ts', {
      root: 'apps/ts',
      sourceRoot: 'apps/ts/src',
    });
    tree.write('apps/ts/tsconfig.json', '{}');
    addProjectConfiguration(tree, 'py', { root: 'apps/py' });
    tree.write('apps/py/pyproject.toml', '');
    addProjectConfiguration(tree, 'both', {
      root: 'apps/both',
      sourceRoot: 'apps/both/src',
    });
    tree.write('apps/both/tsconfig.json', '{}');
    tree.write('apps/both/pyproject.toml', '');
    addProjectConfiguration(tree, 'neither', { root: 'apps/neither' });
    const before = tree.listChanges();

    await expect(
      normalizeComponent(tree, { project: 'ts', name: 'a', infra: 'none' }),
    ).resolves.toMatchObject({ language: 'typescript', ipc: false });
    await expect(
      normalizeComponent(tree, { project: 'py', name: 'a', infra: 'none' }),
    ).resolves.toMatchObject({ language: 'python', ipc: false });
    await expect(
      normalizeComponent(tree, { project: 'both', name: 'a', infra: 'none' }),
    ).rejects.toThrow('both');
    await expect(
      normalizeComponent(tree, {
        project: 'both',
        name: 'a',
        language: 'typescript',
        infra: 'none',
      }),
    ).resolves.toMatchObject({ language: 'typescript' });
    await expect(
      normalizeComponent(tree, {
        project: 'both',
        name: 'a',
        language: 'python',
        infra: 'none',
      }),
    ).resolves.toMatchObject({ language: 'python' });
    await expect(
      normalizeComponent(tree, {
        project: 'neither',
        name: 'a',
        language: 'python',
        infra: 'none',
      }),
    ).rejects.toThrow('neither');
    await expect(
      normalizeComponent(tree, {
        project: 'ts',
        name: 'a',
        language: 'python',
        infra: 'none',
      }),
    ).rejects.toThrow('requires pyproject.toml');
    expect(tree.listChanges()).toEqual(before);
  });

  it('requires explicit versions for Terraform and retains NEXT_* for local components', async () => {
    const tree = await createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'ts', {
      root: 'apps/ts',
      sourceRoot: 'apps/ts/src',
    });
    tree.write('apps/ts/tsconfig.json', '{}');

    await expect(
      normalizeComponent(tree, {
        project: 'ts',
        name: 'terraform-component',
        componentVersion: 'NEXT_PATCH',
        iac: 'terraform',
      }),
    ).rejects.toThrow(
      'Terraform Greengrass components require an explicit semantic version.',
    );

    await expect(
      normalizeComponent(tree, {
        project: 'ts',
        name: 'cdk-component',
        componentVersion: 'NEXT_PATCH',
        iac: 'cdk',
      }),
    ).resolves.toMatchObject({
      componentVersion: 'NEXT_PATCH',
      infra: 'component-version',
      iac: 'cdk',
    });

    await expect(
      normalizeComponent(tree, {
        project: 'ts',
        name: 'local-component',
        componentVersion: 'NEXT_PATCH',
        infra: 'none',
        iac: 'terraform',
      }),
    ).resolves.toMatchObject({
      componentVersion: 'NEXT_PATCH',
      infra: 'none',
      iac: undefined,
    });
  });

  it('applies the shorter component name limit only when IaC resolves to CDK', async () => {
    const tree = await createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'ts', {
      root: 'apps/ts',
      sourceRoot: 'apps/ts/src',
    });
    tree.write('apps/ts/tsconfig.json', '{}');

    await expect(
      normalizeComponent(tree, {
        project: 'ts',
        name: 'component',
        componentName: 'a'.repeat(68),
        iac: 'cdk',
      }),
    ).resolves.toMatchObject({ iac: 'cdk' });
    await expect(
      normalizeComponent(tree, {
        project: 'ts',
        name: 'component',
        componentName: 'a'.repeat(69),
        iac: 'cdk',
      }),
    ).rejects.toThrow(
      /68-character limit.*shorter --name or set --componentName to 68 characters or fewer/,
    );

    tree.write(
      'aws-nx-plugin.config.mts',
      'export default { iac: { provider: "cdk" } };',
    );
    await expect(
      normalizeComponent(tree, {
        project: 'ts',
        name: 'component',
        componentName: 'a'.repeat(69),
        iac: 'inherit',
      }),
    ).rejects.toThrow(/68-character limit/);
  });

  it('keeps the 128-character service limit for Terraform and local components', async () => {
    const tree = await createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'ts', {
      root: 'apps/ts',
      sourceRoot: 'apps/ts/src',
    });
    tree.write('apps/ts/tsconfig.json', '{}');

    const componentName = 'a'.repeat(128);
    await expect(
      normalizeComponent(tree, {
        project: 'ts',
        name: 'component',
        componentName,
        iac: 'terraform',
      }),
    ).resolves.toMatchObject({ iac: 'terraform', componentName });
    await expect(
      normalizeComponent(tree, {
        project: 'ts',
        name: 'component',
        componentName,
        infra: 'none',
      }),
    ).resolves.toMatchObject({ iac: undefined, componentName });
  });

  it('rejects oversized CDK names before writing for both component languages', async () => {
    for (const language of ['python', 'typescript'] as const) {
      const tree = await createTreeUsingTsSolutionSetup();
      seedBothLanguageHost(tree);
      const before = tree.listChanges();

      await expect(
        greengrassComponentGenerator(tree, {
          project: 'both-host',
          name: 'component',
          componentName: 'a'.repeat(69),
          language,
          iac: 'cdk',
        }),
      ).rejects.toThrow(/68-character limit/);
      expect(tree.listChanges()).toEqual(before);
    }
  });

  it('rejects an explicit language that mismatches a single-marker host, through the public generator, before writes', async () => {
    const tree = await createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'ts-host', {
      root: 'apps/ts-host',
      sourceRoot: 'apps/ts-host/src',
    });
    tree.write('apps/ts-host/tsconfig.json', '{}');
    const before = tree.listChanges();

    await expect(
      greengrassComponentGenerator(tree, {
        project: 'ts-host',
        name: 'pulse',
        language: 'python',
      }),
    ).rejects.toThrow('requires pyproject.toml');
    expect(tree.listChanges()).toEqual(before);
  });

  it('rejects an ambiguous both-marker host with no language, through the public generator, before writes', async () => {
    const tree = await createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'both-host', {
      root: 'apps/both-host',
      sourceRoot: 'apps/both-host/src',
    });
    tree.write('apps/both-host/tsconfig.json', '{}');
    tree.write('apps/both-host/pyproject.toml', '');
    const before = tree.listChanges();

    await expect(
      greengrassComponentGenerator(tree, {
        project: 'both-host',
        name: 'pulse',
      }),
    ).rejects.toThrow('both');
    expect(tree.listChanges()).toEqual(before);
  });

  it('rejects a host with neither marker, through the public generator, before writes', async () => {
    const tree = await createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'bare-host', { root: 'apps/bare-host' });
    const before = tree.listChanges();

    await expect(
      greengrassComponentGenerator(tree, {
        project: 'bare-host',
        name: 'pulse',
        language: 'python',
      }),
    ).rejects.toThrow('neither');
    expect(tree.listChanges()).toEqual(before);
  });

  it('rejects a language change under the same component identity before writes', async () => {
    const tree = await createTreeUsingTsSolutionSetup();
    seedBothLanguageHost(tree);

    await greengrassComponentGenerator(tree, {
      project: 'both-host',
      name: 'pulse',
      language: 'python',
      infra: 'none',
    });
    const before = tree.listChanges();

    await expect(
      greengrassComponentGenerator(tree, {
        project: 'both-host',
        name: 'pulse',
        language: 'typescript',
        infra: 'none',
      }),
    ).rejects.toThrow('cannot change language');
    expect(tree.listChanges()).toEqual(before);
  });
});

describe('greengrass#component schema', () => {
  it('declares IPC disabled by default', () => {
    expect(schema.properties.ipc).toMatchObject({
      type: 'boolean',
      default: false,
    });
    expect(schema.properties.componentVersion.description).toContain(
      'Terraform requires an explicit semantic version',
    );
  });
});

describe('greengrassComponentGenerator with an inferred language', () => {
  const seedSingleMarkerHosts = (tree: Tree) => {
    addProjectConfiguration(tree, 'py-host', { root: 'apps/py_host' });
    tree.write(
      'apps/py_host/pyproject.toml',
      '[project]\nname = "py_host"\nversion = "0.1.0"\ndependencies = []\n',
    );
    addProjectConfiguration(tree, 'ts-host', {
      name: 'ts-host',
      root: 'apps/ts-host',
      sourceRoot: 'apps/ts-host/src',
      targets: { compile: { executor: '@nx/js:tsc' } },
    });
    tree.write('apps/ts-host/tsconfig.json', '{}');
    tree.write(
      'apps/ts-host/package.json',
      JSON.stringify({ name: '@proj/ts-host', type: 'module' }),
    );
    tree.write('apps/ts-host/src/index.ts', 'export {};');
  };

  const componentMetadata = (tree: Tree, projectJsonPath: string) =>
    JSON.parse(tree.read(projectJsonPath, 'utf-8')).metadata.components as {
      name: string;
      language: string;
      ipc: boolean;
    }[];

  it('defaults IPC to false for both inferred languages', async () => {
    const tree = await createTreeUsingTsSolutionSetup();
    seedSingleMarkerHosts(tree);

    await greengrassComponentGenerator(tree, {
      project: 'py-host',
      name: 'pulse',
      infra: 'none',
    });
    await greengrassComponentGenerator(tree, {
      project: 'ts-host',
      name: 'beacon',
      infra: 'none',
    });

    expect(
      tree.read('apps/py_host/greengrass/pulse/main.py', 'utf-8'),
    ).not.toContain('GreengrassCoreIPCClientV2');
    expect(
      tree.read('apps/ts-host/src/greengrass/beacon/main.ts', 'utf-8'),
    ).not.toContain('greengrasscoreipc');

    const pyProject = JSON.parse(
      tree.read('apps/py_host/project.json', 'utf-8'),
    );
    expect(componentMetadata(tree, 'apps/py_host/project.json')).toEqual([
      expect.objectContaining({
        name: 'pulse',
        language: 'python',
        ipc: false,
      }),
    ]);
    expect(pyProject.targets['pulse-vendor']).toBeDefined();

    const tsProject = JSON.parse(
      tree.read('apps/ts-host/project.json', 'utf-8'),
    );
    expect(componentMetadata(tree, 'apps/ts-host/project.json')).toEqual([
      expect.objectContaining({
        name: 'beacon',
        language: 'typescript',
        ipc: false,
      }),
    ]);
    // The TypeScript vendor target exists only for an IPC component.
    expect(tsProject.targets['beacon-vendor']).toBeUndefined();
  });

  it('lets an explicit ipc override the inferred language default', async () => {
    const tree = await createTreeUsingTsSolutionSetup();
    seedSingleMarkerHosts(tree);

    await greengrassComponentGenerator(tree, {
      project: 'py-host',
      name: 'pulse',
      ipc: false,
      infra: 'none',
    });
    await greengrassComponentGenerator(tree, {
      project: 'ts-host',
      name: 'beacon',
      ipc: true,
      infra: 'none',
    });

    expect(
      tree.read('apps/py_host/greengrass/pulse/main.py', 'utf-8'),
    ).not.toContain('GreengrassCoreIPCClientV2');
    expect(componentMetadata(tree, 'apps/py_host/project.json')).toEqual([
      expect.objectContaining({
        name: 'pulse',
        language: 'python',
        ipc: false,
      }),
    ]);

    expect(
      tree.read('apps/ts-host/src/greengrass/beacon/main.ts', 'utf-8'),
    ).toContain('greengrasscoreipc');
    expect(componentMetadata(tree, 'apps/ts-host/project.json')).toEqual([
      expect.objectContaining({
        name: 'beacon',
        language: 'typescript',
        ipc: true,
      }),
    ]);
    const tsProject = JSON.parse(
      tree.read('apps/ts-host/project.json', 'utf-8'),
    );
    expect(tsProject.targets['beacon-vendor']).toBeDefined();
  });
});

describe('greengrassComponentGenerator on a both-marker host', () => {
  it('generates a python then a typescript component on the same host', async () => {
    const tree = await createTreeUsingTsSolutionSetup();
    seedBothLanguageHost(tree);

    await greengrassComponentGenerator(tree, {
      project: 'both-host',
      name: 'pulse',
      language: 'python',
      infra: 'none',
    });
    await greengrassComponentGenerator(tree, {
      project: 'both-host',
      name: 'beacon',
      language: 'typescript',
      infra: 'none',
    });

    expect(tree.exists('apps/both-host/greengrass/pulse/main.py')).toBe(true);
    expect(tree.exists('apps/both-host/src/greengrass/beacon/main.ts')).toBe(
      true,
    );

    const projectConfig = JSON.parse(
      tree.read('apps/both-host/project.json', 'utf-8'),
    );
    const components: { name: string; language: string }[] =
      projectConfig.metadata.components;
    expect(components).toHaveLength(2);
    expect(components.find((c) => c.name === 'pulse')?.language).toBe('python');
    expect(components.find((c) => c.name === 'beacon')?.language).toBe(
      'typescript',
    );
    expect(projectConfig.targets['pulse-artifact']).toBeDefined();
    expect(projectConfig.targets['beacon-artifact']).toBeDefined();
  });

  it('produces the same result when the two languages are generated in the opposite order', async () => {
    const tree = await createTreeUsingTsSolutionSetup();
    seedBothLanguageHost(tree);

    await greengrassComponentGenerator(tree, {
      project: 'both-host',
      name: 'beacon',
      language: 'typescript',
      infra: 'none',
    });
    await greengrassComponentGenerator(tree, {
      project: 'both-host',
      name: 'pulse',
      language: 'python',
      infra: 'none',
    });

    expect(tree.exists('apps/both-host/greengrass/pulse/main.py')).toBe(true);
    expect(tree.exists('apps/both-host/src/greengrass/beacon/main.ts')).toBe(
      true,
    );

    const projectConfig = JSON.parse(
      tree.read('apps/both-host/project.json', 'utf-8'),
    );
    expect(projectConfig.metadata.components).toHaveLength(2);
    expect(projectConfig.targets['pulse-artifact']).toBeDefined();
    expect(projectConfig.targets['beacon-artifact']).toBeDefined();
  });

  it('re-running both components with the same options is a stable no-op', async () => {
    const tree = await createTreeUsingTsSolutionSetup();
    seedBothLanguageHost(tree);
    const pulseOptions = {
      project: 'both-host',
      name: 'pulse',
      language: 'python' as const,
      infra: 'none' as const,
    };
    const beaconOptions = {
      project: 'both-host',
      name: 'beacon',
      language: 'typescript' as const,
      infra: 'none' as const,
    };

    await greengrassComponentGenerator(tree, pulseOptions);
    await greengrassComponentGenerator(tree, beaconOptions);
    const projectJsonAfterFirstRun = tree.read(
      'apps/both-host/project.json',
      'utf-8',
    );

    await greengrassComponentGenerator(tree, pulseOptions);
    await greengrassComponentGenerator(tree, beaconOptions);

    expect(tree.read('apps/both-host/project.json', 'utf-8')).toBe(
      projectJsonAfterFirstRun,
    );
    const projectConfig = JSON.parse(projectJsonAfterFirstRun);
    expect(projectConfig.metadata.components).toHaveLength(2);
  });
});
