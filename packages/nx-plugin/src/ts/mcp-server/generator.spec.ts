/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, readProjectConfiguration } from '@nx/devkit';
import {
  tsMcpServerGenerator,
  TS_MCP_SERVER_GENERATOR_INFO,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { sortObjectKeys } from '../../utils/object';

describe('ts#mcp-server generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate a TypeScript MCP server with correct structure', async () => {
    await tsMcpServerGenerator(tree, { name: 'test-server' });

    // Check that the project was created
    const config = readProjectConfiguration(tree, '@proj/test-server');
    expect(config).toBeDefined();
    expect(config.root).toBe('test-server');
    expect(config.sourceRoot).toBe('test-server/src');

    // Check that the source files were generated
    expect(tree.exists('test-server/src/index.ts')).toBeTruthy();
    expect(tree.exists('test-server/src/server.ts')).toBeTruthy();
    expect(tree.exists('test-server/src/global.d.ts')).toBeTruthy();
    expect(
      tree.exists('test-server/src/resources/example-context.md'),
    ).toBeTruthy();
    expect(tree.exists('test-server/README.md')).toBeTruthy();
  });

  it('should add required dependencies to package.json', async () => {
    await tsMcpServerGenerator(tree, { name: 'test-server' });

    // Read package.json to verify dependencies
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));

    // Check for required dependencies
    expect(packageJson.dependencies['@modelcontextprotocol/sdk']).toBeDefined();
    expect(packageJson.dependencies['zod']).toBeDefined();

    // Check for required dev dependencies
    expect(packageJson.devDependencies['tsx']).toBeDefined();
    expect(packageJson.devDependencies['esbuild']).toBeDefined();
  });

  it('should add correct build targets to project configuration', async () => {
    await tsMcpServerGenerator(tree, { name: 'test-server' });

    const config = readProjectConfiguration(tree, '@proj/test-server');

    // Check for bundle target
    expect(config.targets.bundle).toBeDefined();
    expect(config.targets.bundle.executor).toBe('nx:run-commands');
    expect(config.targets.bundle.options.commands[0]).toContain('esbuild');
    expect(config.targets.bundle.options.commands[0]).toContain('--bundle');
    expect(config.targets.bundle.options.commands[0]).toContain(
      '--platform=node',
    );
    expect(config.targets.bundle.options.commands[0]).toContain('--format=esm');
    expect(config.targets.bundle.options.commands[0]).toContain(
      '--loader:.md=text',
    );

    // Check for dev target
    expect(config.targets.dev).toBeDefined();
    expect(config.targets.dev.executor).toBe('nx:run-commands');
    expect(config.targets.dev.options.commands[0]).toContain('nx watch');
    expect(config.targets.dev.options.commands[0]).toContain(
      'nx run @proj/test-server:bundle',
    );

    // Check that build depends on bundle
    expect(config.targets.build).toBeDefined();
    expect(config.targets.build.dependsOn).toContain('bundle');
  });

  it('should handle custom directory path', async () => {
    await tsMcpServerGenerator(tree, {
      name: 'test-server',
      directory: 'custom-dir',
    });

    // Check that the project was created in the custom directory
    const config = readProjectConfiguration(tree, '@proj/test-server');
    expect(config).toBeDefined();
    expect(config.root).toBe('custom-dir/test-server');
    expect(config.sourceRoot).toBe('custom-dir/test-server/src');

    // Check that the source files were generated in the custom directory
    expect(tree.exists('custom-dir/test-server/src/index.ts')).toBeTruthy();
    expect(tree.exists('custom-dir/test-server/src/server.ts')).toBeTruthy();
  });

  it('should match snapshot', async () => {
    await tsMcpServerGenerator(tree, { name: 'test-server' });

    const changes = sortObjectKeys(
      tree
        .listChanges()
        .filter((f) => f.path.startsWith('test-server/'))
        .reduce((acc, curr) => {
          acc[curr.path] = tree.read(curr.path, 'utf-8');
          return acc;
        }, {}),
    );

    // Verify project files
    expect(changes).toMatchSnapshot('mcp-server-files');
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree);

    await tsMcpServerGenerator(tree, { name: 'test-server' });

    expectHasMetricTags(tree, TS_MCP_SERVER_GENERATOR_INFO.metric);
  });
});
