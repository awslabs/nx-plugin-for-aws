/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { AWS_NX_PLUGIN_CONFIG_FILE_NAME } from '../../../utils/config/utils';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

describe('remove mcp inspector license exceptions migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

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
});
