/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import { describe, expect, it } from 'vitest';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils.js';
import { createTreeUsingTsSolutionSetup } from '../../utils/test.js';
import { normalizeComponent } from './common.js';
import { greengrassComponentGenerator } from './generator.js';
import schema from './schema.json' with { type: 'json' };

const seedPythonHost = (tree: Tree) => {
  addProjectConfiguration(tree, 'host', { root: 'apps/host' });
  tree.write(
    'apps/host/pyproject.toml',
    '[project]\nname = "host"\nversion = "0.1.0"\ndependencies = []\n',
  );
};

describe('greengrassComponentGenerator preflight', () => {
  it.each([false, true])(
    'rejects a host without pyproject.toml before writes (tsconfig=%s)',
    async (hasTypeScript) => {
      const tree = createTreeUsingTsSolutionSetup();
      addProjectConfiguration(tree, 'host', { root: 'apps/host' });
      if (hasTypeScript) {
        tree.write('apps/host/tsconfig.json', '{}');
      }
      const before = tree.listChanges();
      await expect(
        greengrassComponentGenerator(tree, { project: 'host', name: 'pulse' }),
      ).rejects.toThrow('requires pyproject.toml');
      expect(tree.listChanges()).toEqual(before);
    },
  );

  it('normalizes a Python host without writing', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    seedPythonHost(tree);
    const before = tree.listChanges();
    await expect(
      normalizeComponent(tree, {
        project: 'host',
        name: 'pulse',
        infra: 'none',
      }),
    ).resolves.toMatchObject({
      language: 'python',
      ipc: false,
      gdkConfig: false,
      platform: 'linux-arm64',
      componentVersion: '1.0.0',
      iac: undefined,
    });
    expect(tree.listChanges()).toEqual(before);
  });

  it('rejects inherited Terraform before any generator mutation', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    seedPythonHost(tree);
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, { iac: { provider: 'terraform' } });
    const before = tree.listChanges();
    await expect(
      greengrassComponentGenerator(tree, { project: 'host', name: 'pulse' }),
    ).rejects.toThrow('infrastructure requires CDK');
    expect(tree.listChanges()).toEqual(before);
  });

  it('resolves inherited CDK without writes', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    seedPythonHost(tree);
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, { iac: { provider: 'cdk' } });
    const before = tree.listChanges();
    await expect(
      normalizeComponent(tree, { project: 'host', name: 'pulse' }),
    ).resolves.toMatchObject({ iac: 'cdk', infra: 'component-version' });
    expect(tree.listChanges()).toEqual(before);
  });

  it('keeps local development available in a Terraform workspace', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    seedPythonHost(tree);
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, { iac: { provider: 'terraform' } });
    await greengrassComponentGenerator(tree, {
      project: 'host',
      name: 'pulse',
      infra: 'none',
    });
    expect(tree.exists('apps/host/greengrass/pulse/main.py')).toBe(true);
    expect(tree.exists('packages/common/terraform')).toBe(false);
    expect(tree.exists('packages/common/constructs')).toBe(false);
  });

  it.each(['NEXT_PATCH', 'NEXT_MINOR', 'NEXT_MAJOR'])(
    'accepts %s for CDK and local version resolution',
    async (componentVersion) => {
      const tree = createTreeUsingTsSolutionSetup();
      seedPythonHost(tree);
      const before = tree.listChanges();
      await expect(
        normalizeComponent(tree, {
          project: 'host',
          name: 'pulse',
          componentVersion,
          iac: 'cdk',
        }),
      ).resolves.toMatchObject({ componentVersion, iac: 'cdk' });
      await expect(
        normalizeComponent(tree, {
          project: 'host',
          name: 'pulse',
          componentVersion,
          infra: 'none',
        }),
      ).resolves.toMatchObject({ componentVersion, iac: undefined });
      expect(tree.listChanges()).toEqual(before);
    },
  );
});

describe('greengrass#component Python defaults', () => {
  it('infers Python and persists disabled IPC', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    seedPythonHost(tree);
    await greengrassComponentGenerator(tree, {
      project: 'host',
      name: 'pulse',
      infra: 'none',
    });
    expect(
      tree.read('apps/host/greengrass/pulse/main.py', 'utf-8'),
    ).not.toContain('GreengrassCoreIPCClientV2');
    const config = JSON.parse(tree.read('apps/host/project.json', 'utf-8'));
    expect(config.metadata.components).toEqual([
      expect.objectContaining({
        name: 'pulse',
        language: 'python',
        ipc: false,
      }),
    ]);
    expect(config.targets['pulse-vendor']).toBeDefined();
  });

  it('lets an explicit IPC option override the default', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    seedPythonHost(tree);
    await greengrassComponentGenerator(tree, {
      project: 'host',
      name: 'pulse',
      ipc: true,
      infra: 'none',
    });
    expect(tree.read('apps/host/greengrass/pulse/main.py', 'utf-8')).toContain(
      'GreengrassCoreIPCClientV2',
    );
    const config = JSON.parse(tree.read('apps/host/project.json', 'utf-8'));
    expect(config.metadata.components[0].ipc).toBe(true);
  });

  it('advertises only the implemented language and provider', () => {
    expect(schema.properties.language.enum).toEqual(['python']);
    expect(schema.properties.iac.enum).toEqual(['inherit', 'cdk']);
    expect(schema.properties.ipc.default).toBe(false);
    expect(schema.properties.gdkConfig.default).toBe(false);
    expect(schema.properties.componentVersion.description).toContain(
      'CDK resolves NEXT_*',
    );
  });
});

describe('CDK component name limits', () => {
  it('accepts 68 characters and rejects 69 characters before writes', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    seedPythonHost(tree);
    await expect(
      normalizeComponent(tree, {
        project: 'host',
        name: 'pulse',
        componentName: 'a'.repeat(68),
        iac: 'cdk',
      }),
    ).resolves.toMatchObject({ iac: 'cdk' });
    const before = tree.listChanges();
    await expect(
      greengrassComponentGenerator(tree, {
        project: 'host',
        name: 'pulse',
        componentName: 'a'.repeat(69),
        iac: 'cdk',
      }),
    ).rejects.toThrow(/68-character limit/);
    expect(tree.listChanges()).toEqual(before);
  });

  it('rejects inherited CDK names and allows 128 characters without infrastructure', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    seedPythonHost(tree);
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, { iac: { provider: 'cdk' } });
    await expect(
      normalizeComponent(tree, {
        project: 'host',
        name: 'pulse',
        componentName: 'a'.repeat(69),
      }),
    ).rejects.toThrow(/68-character limit/);
    await expect(
      normalizeComponent(tree, {
        project: 'host',
        name: 'pulse',
        componentName: 'a'.repeat(128),
        infra: 'none',
      }),
    ).resolves.toMatchObject({ iac: undefined });
  });
});
