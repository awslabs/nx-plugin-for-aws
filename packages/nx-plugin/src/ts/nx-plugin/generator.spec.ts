/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, readProjectConfiguration, readJson } from '@nx/devkit';
import { tsNxPluginGenerator, TS_NX_PLUGIN_GENERATOR_INFO } from './generator';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';

describe('ts#nx-plugin generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should configure the project as an Nx Plugin with correct targets', async () => {
    await tsNxPluginGenerator(tree, { name: 'test-plugin' });

    const project = readProjectConfiguration(tree, '@proj/test-plugin');

    // Should have package target
    expect(project.targets?.package).toBeDefined();
    expect(project.targets?.package?.executor).toBe('@nx/js:tsc');
    expect(project.targets?.package?.outputs).toEqual(['{options.outputPath}']);
    expect(project.targets?.package?.options?.outputPath).toBe(
      'dist/test-plugin/package',
    );
    expect(project.targets?.package?.options?.main).toBe(
      'test-plugin/src/index.ts',
    );
    expect(project.targets?.package?.options?.tsConfig).toBe(
      'test-plugin/tsconfig.lib.json',
    );

    // Should have correct assets
    const assets = project.targets?.package?.options?.assets;
    expect(assets).toContain('test-plugin/*.md');
    expect(assets).toContain('test-plugin/LICENSE*');
    expect(assets).toContain('test-plugin/NOTICE');
    expect(assets).toContainEqual({
      input: './test-plugin/src',
      glob: '**/!(*.ts)',
      output: './src',
    });
    expect(assets).toContainEqual({
      input: './test-plugin/src',
      glob: '**/*.d.ts',
      output: './src',
    });
    expect(assets).toContainEqual({
      input: './test-plugin',
      glob: 'generators.json',
      output: '.',
    });
    expect(assets).toContainEqual({
      input: './test-plugin',
      glob: 'executors.json',
      output: '.',
    });
  });

  it('should configure build target to depend on package', async () => {
    await tsNxPluginGenerator(tree, { name: 'test-plugin' });

    const project = readProjectConfiguration(tree, '@proj/test-plugin');

    expect(project.targets?.build?.dependsOn).toContain('package');
  });

  it('should clear the index.ts file', async () => {
    await tsNxPluginGenerator(tree, { name: 'test-plugin' });

    const indexContent = tree.read('test-plugin/src/index.ts')?.toString();
    expect(indexContent).toBe('');
  });

  it('should configure TypeScript project as Nx Plugin', async () => {
    await tsNxPluginGenerator(tree, { name: 'test-plugin' });

    // Check tsconfig.json has commonjs module
    const tsConfig = readJson(tree, 'test-plugin/tsconfig.json');
    expect(tsConfig.compilerOptions?.module).toBe('commonjs');

    // Check generators.json exists
    expect(tree.exists('test-plugin/generators.json')).toBe(true);
    const generatorsJson = readJson(tree, 'test-plugin/generators.json');
    expect(generatorsJson.generators).toBeDefined();

    // Check package.json configuration
    expect(tree.exists('test-plugin/package.json')).toBe(true);
    const packageJson = readJson(tree, 'test-plugin/package.json');
    expect(packageJson.main).toBe('./src/index.js');
    expect(packageJson.generators).toBe('./generators.json');
  });

  it('should generate MCP server files', async () => {
    await tsNxPluginGenerator(tree, { name: 'test-plugin' });

    const project = readProjectConfiguration(tree, '@proj/test-plugin');
    const mcpPath = `${project.sourceRoot}/mcp-server`;

    // Should generate MCP server files
    expect(tree.exists(`${mcpPath}/server.ts`)).toBe(true);
    expect(tree.exists(`${mcpPath}/tools/general-guidance.ts`)).toBe(true);
    expect(tree.exists(`${mcpPath}/tools/create-workspace-command.ts`)).toBe(
      true,
    );
    expect(tree.exists(`${mcpPath}/tools/generator-guide.ts`)).toBe(true);

    snapshotTreeDir(tree, mcpPath);
  });

  it('should remove sample MCP server files', async () => {
    await tsNxPluginGenerator(tree, { name: 'test-plugin' });

    const project = readProjectConfiguration(tree, '@proj/test-plugin');
    const mcpPath = `${project.sourceRoot}/mcp-server`;

    // Should not have sample files
    expect(tree.exists(`${mcpPath}/tools/add.ts`)).toBe(false);
    expect(tree.exists(`${mcpPath}/resources/sample-guidance.ts`)).toBe(false);
  });

  it('should add required dependencies', async () => {
    // Modify package.json to simulate external workspace
    tree.write(
      'package.json',
      JSON.stringify({
        name: 'external-workspace',
        version: '1.0.0',
      }),
    );

    await tsNxPluginGenerator(tree, { name: 'test-plugin' });

    const rootPackageJson = readJson(tree, 'package.json');
    expect(rootPackageJson.devDependencies?.['@nx/devkit']).toBeDefined();
    expect(rootPackageJson.devDependencies?.['@aws/nx-plugin']).toBeDefined();

    const projectPackageJson = readJson(tree, 'test-plugin/package.json');
    expect(projectPackageJson.dependencies?.['@nx/devkit']).toBeDefined();
    expect(projectPackageJson.dependencies?.['@aws/nx-plugin']).toBeDefined();
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree);

    await tsNxPluginGenerator(tree, { name: 'my-plugin' });

    expectHasMetricTags(tree, TS_NX_PLUGIN_GENERATOR_INFO.metric);
  });
});
