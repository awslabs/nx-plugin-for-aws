/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, Tree, writeJson } from '@nx/devkit';
import {
  tsMcpServerGenerator,
  TS_MCP_SERVER_GENERATOR_INFO,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';

describe('ts#mcp-server generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();

    // Create an existing TypeScript project
    addProjectConfiguration(tree, 'test-project', {
      root: 'apps/test-project',
      sourceRoot: 'apps/test-project/src',
      targets: {
        build: {
          executor: '@nx/js:tsc',
          options: {
            outputPath: 'dist/apps/test-project',
          },
        },
      },
    });

    // Create tsconfig.json for the project
    writeJson(tree, 'apps/test-project/tsconfig.json', {});

    // Create a basic package.json for the project
    writeJson(tree, 'apps/test-project/package.json', {
      name: 'test-project',
      version: '1.0.0',
    });
  });

  it('should add MCP server to existing TypeScript project with default name', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
    });

    // Check that MCP server files were added to the existing project
    expect(
      tree.exists('apps/test-project/src/mcp-server/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/mcp-server/server.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/mcp-server/stdio.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/mcp-server/http.ts'),
    ).toBeTruthy();

    // Check that package.json was updated with bin entry
    const packageJson = JSON.parse(
      tree.read('apps/test-project/package.json', 'utf-8'),
    );
    expect(packageJson.bin).toBeDefined();
    expect(packageJson.bin['test-project-mcp-server']).toBe(
      './src/mcp-server/stdio.js',
    );

    // Check that project configuration was updated with serve target
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['mcp-server-serve-stdio']).toBeDefined();
    expect(projectConfig.targets['mcp-server-serve-stdio'].executor).toBe(
      'nx:run-commands',
    );
    expect(
      projectConfig.targets['mcp-server-serve-stdio'].options.commands[0],
    ).toContain('tsx --watch ./src/mcp-server/stdio.ts');

    expect(projectConfig.targets['mcp-server-serve-http']).toBeDefined();
    expect(projectConfig.targets['mcp-server-serve-http'].executor).toBe(
      'nx:run-commands',
    );
    expect(
      projectConfig.targets['mcp-server-serve-http'].options.commands[0],
    ).toContain('tsx --watch ./src/mcp-server/http.ts');
  });

  it('should add MCP server with custom name', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'custom-server',
    });

    // Check that MCP server files were added with custom name
    expect(
      tree.exists('apps/test-project/src/custom-server/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/custom-server/server.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/custom-server/stdio.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/custom-server/http.ts'),
    ).toBeTruthy();

    // Check that package.json was updated with custom bin entry
    const packageJson = JSON.parse(
      tree.read('apps/test-project/package.json', 'utf-8'),
    );
    expect(packageJson.bin['custom-server']).toBe(
      './src/custom-server/stdio.js',
    );

    // Check that project configuration was updated with custom serve target
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['custom-server-serve-stdio']).toBeDefined();
    expect(projectConfig.targets['custom-server-serve-http']).toBeDefined();
  });

  it('should handle ESM projects correctly', async () => {
    // Update package.json to be ESM
    writeJson(tree, 'apps/test-project/package.json', {
      name: 'test-project',
      version: '1.0.0',
      type: 'module',
    });

    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'esm-server',
    });

    // Check that files were generated (ESM flag should be passed to templates)
    expect(
      tree.exists('apps/test-project/src/esm-server/index.ts'),
    ).toBeTruthy();

    // Verify the generated files contain ESM-specific content
    const indexContent = tree.read(
      'apps/test-project/src/esm-server/index.ts',
      'utf-8',
    );
    expect(indexContent).toContain('server.js');
  });

  it('should handle CommonJS projects correctly', async () => {
    // package.json without type: 'module' defaults to CommonJS
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'cjs-server',
    });

    // Check that files were generated
    expect(
      tree.exists('apps/test-project/src/cjs-server/index.ts'),
    ).toBeTruthy();

    // Verify the generated files
    const indexContent = tree.read(
      'apps/test-project/src/cjs-server/index.ts',
      'utf-8',
    );
    expect(indexContent).toContain('server');
    expect(indexContent).not.toContain('server.js');
  });

  it('should create package.json if it does not exist', async () => {
    // Remove the package.json
    tree.delete('apps/test-project/package.json');

    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'new-server',
    });

    // Check that package.json was created
    expect(tree.exists('apps/test-project/package.json')).toBeTruthy();

    const packageJson = JSON.parse(
      tree.read('apps/test-project/package.json', 'utf-8'),
    );
    expect(packageJson.name).toBe('test-project');
    expect(packageJson.type).toBe('module'); // Default to ESM
    expect(packageJson.bin['new-server']).toBe('./src/new-server/stdio.js');
  });

  it('should add dependencies to both root and project package.json', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
    });

    // Check root package.json dependencies
    const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(
      rootPackageJson.dependencies['@modelcontextprotocol/sdk'],
    ).toBeDefined();
    expect(rootPackageJson.dependencies['zod-v3']).toBeDefined();
    expect(rootPackageJson.dependencies['express']).toBeDefined();
    expect(rootPackageJson.devDependencies['tsx']).toBeDefined();
    expect(rootPackageJson.devDependencies['@types/express']).toBeDefined();

    // Check project package.json dependencies
    const projectPackageJson = JSON.parse(
      tree.read('apps/test-project/package.json', 'utf-8'),
    );
    expect(
      projectPackageJson.dependencies['@modelcontextprotocol/sdk'],
    ).toBeDefined();
    expect(projectPackageJson.dependencies['zod-v3']).toBeDefined();
    expect(projectPackageJson.dependencies['express']).toBeDefined();
    expect(projectPackageJson.devDependencies['tsx']).toBeDefined();
    expect(projectPackageJson.devDependencies['@types/express']).toBeDefined();
  });

  it('should handle project without sourceRoot', async () => {
    // Create project without sourceRoot
    addProjectConfiguration(tree, 'no-source-root', {
      root: 'apps/no-source-root',
      targets: {
        build: {
          executor: '@nx/js:tsc',
        },
      },
    });

    writeJson(tree, 'apps/no-source-root/tsconfig.json', {
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
      },
    });

    await tsMcpServerGenerator(tree, {
      project: 'no-source-root',
      name: 'default-src-server',
    });

    // Should default to {projectRoot}/src
    expect(
      tree.exists('apps/no-source-root/src/default-src-server/index.ts'),
    ).toBeTruthy();
  });

  it('should handle kebab-case conversion for names with special characters', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'My_Special#Server!',
    });

    // Name should be converted to kebab-case
    expect(
      tree.exists('apps/test-project/src/my-special-server/index.ts'),
    ).toBeTruthy();

    const packageJson = JSON.parse(
      tree.read('apps/test-project/package.json', 'utf-8'),
    );
    expect(packageJson.bin['my-special-server']).toBeDefined();
  });

  it('should throw error for non-TypeScript project', async () => {
    // Create project without tsconfig.json
    addProjectConfiguration(tree, 'non-ts-project', {
      root: 'apps/non-ts-project',
      sourceRoot: 'apps/non-ts-project/src',
    });

    await expect(
      tsMcpServerGenerator(tree, {
        project: 'non-ts-project',
      }),
    ).rejects.toThrow(
      'Unsupported project non-ts-project. Expected a TypeScript project (with a tsconfig.json)',
    );
  });

  it('should handle nested project names correctly', async () => {
    // Create a project with nested name
    addProjectConfiguration(tree, '@org/nested-project', {
      root: 'libs/nested-project',
      sourceRoot: 'libs/nested-project/src',
    });

    writeJson(tree, 'libs/nested-project/tsconfig.json', {
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
      },
    });

    await tsMcpServerGenerator(tree, {
      project: '@org/nested-project',
    });

    // Should use the last part of the project name for default server name
    expect(
      tree.exists('libs/nested-project/src/mcp-server/index.ts'),
    ).toBeTruthy();

    const packageJson = JSON.parse(
      tree.read('libs/nested-project/package.json', 'utf-8'),
    );
    expect(packageJson.bin['nested-project-mcp-server']).toBeDefined();
  });

  it('should match snapshot for generated files', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'snapshot-server',
    });

    // Snapshot the generated MCP server files
    const indexContent = tree.read(
      'apps/test-project/src/snapshot-server/index.ts',
      'utf-8',
    );
    const serverContent = tree.read(
      'apps/test-project/src/snapshot-server/server.ts',
      'utf-8',
    );
    const stdioContent = tree.read(
      'apps/test-project/src/snapshot-server/stdio.ts',
      'utf-8',
    );
    const httpContent = tree.read(
      'apps/test-project/src/snapshot-server/http.ts',
      'utf-8',
    );

    expect(indexContent).toMatchSnapshot('mcp-server-index.ts');
    expect(serverContent).toMatchSnapshot('mcp-server-server.ts');
    expect(stdioContent).toMatchSnapshot('mcp-server-stdio.ts');
    expect(httpContent).toMatchSnapshot('mcp-server-http.ts');

    // Snapshot the updated package.json
    const packageJson = tree.read('apps/test-project/package.json', 'utf-8');
    expect(packageJson).toMatchSnapshot('updated-package.json');
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree);

    await tsMcpServerGenerator(tree, {
      project: 'test-project',
    });

    expectHasMetricTags(tree, TS_MCP_SERVER_GENERATOR_INFO.metric);
  });
});
