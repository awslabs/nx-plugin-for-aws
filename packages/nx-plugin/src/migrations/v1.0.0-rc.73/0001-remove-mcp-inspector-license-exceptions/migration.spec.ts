/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, updateJson } from '@nx/devkit';
import yaml from 'js-yaml';
import { beforeEach, describe, expect, it } from 'vitest';
import { AWS_NX_PLUGIN_CONFIG_FILE_NAME } from '../../../utils/config/utils';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

describe('remove mcp inspector license exceptions migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  const withInspectorInstalled = () =>
    updateJson(tree, 'package.json', (json) => {
      json.devDependencies = {
        ...json.devDependencies,
        '@modelcontextprotocol/inspector': '2.2.0',
      };
      return json;
    });

  const readAllowBuilds = () =>
    (
      (yaml.load(tree.read('pnpm-workspace.yaml', 'utf-8')!) as Record<
        string,
        any
      >) ?? {}
    ).allowBuilds ?? {};

  const writeConfig = (body: string) =>
    tree.write(
      AWS_NX_PLUGIN_CONFIG_FILE_NAME,
      `import { AwsNxPluginConfig } from '@aws/nx-plugin';\n\nexport default ${body} satisfies AwsNxPluginConfig;\n`,
    );

  const read = () => tree.read(AWS_NX_PLUGIN_CONFIG_FILE_NAME, 'utf-8')!;

  it('should remove every MCP Inspector exception, keeping the others', async () => {
    writeConfig(`{
  license: {
    dependencies: {
      allow: [],
      collectors: [],
      exceptions: [
        { package: 'jsonpatch', reason: 'keep me', spdx: 'BSD-3-Clause' },
        { package: '@modelcontextprotocol/inspector', reason: 'x', spdx: 'Apache-2.0' },
        { package: '@modelcontextprotocol/inspector-cli', reason: 'x', spdx: 'Apache-2.0' },
        { package: '@modelcontextprotocol/inspector-server', reason: 'x', spdx: 'Apache-2.0' },
        { package: '@modelcontextprotocol/inspector-client', reason: 'x', spdx: 'Apache-2.0' },
        { package: 'jsonpointer', reason: 'keep me too', spdx: 'BSD-3-Clause' },
      ],
    },
  },
}`);

    await migration(tree);

    const config = read();
    expect(config).not.toContain('@modelcontextprotocol/inspector');
    expect(config).toContain('jsonpatch');
    expect(config).toContain('jsonpointer');
    // No array hole left behind by the removals.
    expect(config).not.toMatch(/,\s*,/);
  });

  it('should be a no-op when no MCP Inspector exceptions are present', async () => {
    writeConfig(`{
  license: {
    dependencies: {
      allow: [],
      collectors: [],
      exceptions: [
        { package: 'jsonpatch', reason: 'keep me', spdx: 'BSD-3-Clause' },
      ],
    },
  },
}`);
    const before = read();

    await migration(tree);

    expect(read()).toBe(before);
  });

  it('should leave an empty exceptions array when only Inspector entries existed', async () => {
    writeConfig(`{
  license: {
    dependencies: {
      allow: [],
      collectors: [],
      exceptions: [
        { package: '@modelcontextprotocol/inspector', reason: 'x', spdx: 'Apache-2.0' },
      ],
    },
  },
}`);

    await migration(tree);

    const config = read();
    expect(config).not.toContain('@modelcontextprotocol/inspector');
    expect(config).toContain('exceptions: []');
  });

  it('should be a no-op when the workspace has no config file', async () => {
    await expect(migration(tree)).resolves.not.toThrow();
    expect(tree.exists(AWS_NX_PLUGIN_CONFIG_FILE_NAME)).toBeFalsy();
  });

  it('should reject the inspector build when the workspace has it installed', async () => {
    tree.write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    withInspectorInstalled();

    await migration(tree);

    // v2 added a postinstall script, so an upgrading workspace needs the entry
    // or pnpm 11 fails the install the version sync runs.
    expect(readAllowBuilds()['@modelcontextprotocol/inspector']).toBe(false);
  });

  it('should not register the inspector when the workspace does not have it', async () => {
    tree.write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');

    await migration(tree);

    expect(readAllowBuilds()).not.toHaveProperty(
      '@modelcontextprotocol/inspector',
    );
  });

  it('should preserve an existing allowBuilds decision for other packages', async () => {
    tree.write(
      'pnpm-workspace.yaml',
      'packages:\n  - packages/*\nallowBuilds:\n  esbuild: true\n',
    );
    withInspectorInstalled();

    await migration(tree);

    const allowBuilds = readAllowBuilds();
    expect(allowBuilds.esbuild).toBe(true);
    expect(allowBuilds['@modelcontextprotocol/inspector']).toBe(false);
  });
});
