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
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils';

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
      computeType: 'None',
      iacProvider: 'CDK',
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

    // There should be no Dockerfile since the computeType is None
    expect(
      tree.exists('apps/test-project/src/mcp-server/Dockerfile'),
    ).toBeFalsy();

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

    expect(projectConfig.targets['mcp-server-serve']).toBeDefined();
    expect(projectConfig.targets['mcp-server-serve'].executor).toBe(
      'nx:run-commands',
    );
    expect(
      projectConfig.targets['mcp-server-serve'].options.commands[0],
    ).toContain('tsx --watch ./src/mcp-server/http.ts');

    expect(projectConfig.targets['mcp-server-inspect']).toBeDefined();
    expect(projectConfig.targets['mcp-server-inspect'].executor).toBe(
      'nx:run-commands',
    );
    expect(
      projectConfig.targets['mcp-server-inspect'].options.commands[0],
    ).toContain('mcp-inspector -- tsx --watch ./src/mcp-server/stdio.ts');
  });

  it('should add MCP server with custom name', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'custom-server',
      computeType: 'None',
      iacProvider: 'CDK',
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
    expect(projectConfig.targets['custom-server-serve']).toBeDefined();
    expect(projectConfig.targets['custom-server-inspect']).toBeDefined();
    expect(
      projectConfig.targets['custom-server-inspect'].options.commands[0],
    ).toContain('mcp-inspector -- tsx --watch ./src/custom-server/stdio.ts');
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
      computeType: 'None',
      iacProvider: 'CDK',
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
      computeType: 'None',
      iacProvider: 'CDK',
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
      computeType: 'None',
      iacProvider: 'CDK',
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
      computeType: 'None',
      iacProvider: 'CDK',
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
    expect(
      rootPackageJson.devDependencies['@modelcontextprotocol/inspector'],
    ).toBeDefined();

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
    expect(
      projectPackageJson.devDependencies['@modelcontextprotocol/inspector'],
    ).toBeDefined();
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
      computeType: 'None',
      iacProvider: 'CDK',
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
      computeType: 'None',
      iacProvider: 'CDK',
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
        computeType: 'None',
        iacProvider: 'CDK',
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
      computeType: 'None',
      iacProvider: 'CDK',
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
      computeType: 'None',
      iacProvider: 'CDK',
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

  it('should generate MCP server with BedrockAgentCoreRuntime and default name', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
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

    // Dockerfile should be included for BedrockAgentCoreRuntime
    expect(
      tree.exists('apps/test-project/src/mcp-server/Dockerfile'),
    ).toBeTruthy();

    // Check that package.json was updated with bin entry
    const packageJson = JSON.parse(
      tree.read('apps/test-project/package.json', 'utf-8'),
    );
    expect(packageJson.bin).toBeDefined();
    expect(packageJson.bin['test-project-mcp-server']).toBe(
      './src/mcp-server/stdio.js',
    );

    // Check that project configuration was updated with serve targets
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['mcp-server-serve-stdio']).toBeDefined();
    expect(projectConfig.targets['mcp-server-serve']).toBeDefined();

    // Check that rolldown bundle target was added
    expect(projectConfig.targets['bundle']).toBeDefined();
    expect(projectConfig.targets['bundle'].executor).toBe('nx:run-commands');
    expect(projectConfig.targets['bundle'].options.command).toBe(
      'rolldown -c rolldown.config.ts',
    );
    expect(projectConfig.targets['bundle'].options.cwd).toBe('{projectRoot}');

    // Check that docker target was added
    expect(projectConfig.targets['mcp-server-docker']).toBeDefined();
    expect(projectConfig.targets['mcp-server-docker'].options.command).toBe(
      'docker build --platform linux/arm64 -t proj-test-project-mcp-server:latest apps/test-project/src/mcp-server --build-context workspace=.',
    );
    expect(projectConfig.targets['mcp-server-docker'].dependsOn).toEqual([
      'bundle',
    ]);
  });

  it('should generate MCP server with BedrockAgentCoreRuntime and custom name', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'custom-bedrock-server',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Check that MCP server files were added with custom name
    expect(
      tree.exists('apps/test-project/src/custom-bedrock-server/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/custom-bedrock-server/server.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/custom-bedrock-server/stdio.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/custom-bedrock-server/http.ts'),
    ).toBeTruthy();

    // Dockerfile should be included for BedrockAgentCoreRuntime
    expect(
      tree.exists('apps/test-project/src/custom-bedrock-server/Dockerfile'),
    ).toBeTruthy();

    // Check that package.json was updated with custom bin entry
    const packageJson = JSON.parse(
      tree.read('apps/test-project/package.json', 'utf-8'),
    );
    expect(packageJson.bin['custom-bedrock-server']).toBe(
      './src/custom-bedrock-server/stdio.js',
    );

    // Check that project configuration was updated with custom serve targets
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(
      projectConfig.targets['custom-bedrock-server-serve-stdio'],
    ).toBeDefined();
    expect(projectConfig.targets['custom-bedrock-server-serve']).toBeDefined();

    // Check that rolldown bundle target was added
    expect(projectConfig.targets['bundle']).toBeDefined();

    // Check that docker target was added with custom name
    expect(projectConfig.targets['custom-bedrock-server-docker']).toBeDefined();
  });

  it('should add additional dependencies for BedrockAgentCoreRuntime', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
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

    // Additional dependencies for BedrockAgentCoreRuntime
    expect(rootPackageJson.devDependencies['rolldown']).toBeDefined();

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

    // rolldown is only added to root package.json, not project package.json
    expect(
      projectPackageJson.devDependencies['@modelcontextprotocol/inspector'],
    ).toBeDefined();
  });

  it('should generate shared constructs for BedrockAgentCoreRuntime', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Verify shared constructs setup
    expect(
      tree.exists('packages/common/constructs/src/core/agent-core/runtime.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/constructs/src/app/mcp-servers/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/constructs/src/app/mcp-servers/test-project-mcp-server/test-project-mcp-server.ts',
      ),
    ).toBeTruthy();

    // Check that the MCP server construct exports are added
    expect(
      tree.read(
        'packages/common/constructs/src/app/mcp-servers/index.ts',
        'utf-8',
      ),
    ).toContain(
      "export * from './test-project-mcp-server/test-project-mcp-server.js'",
    );

    // Check that the app index exports MCP servers
    expect(
      tree.read('packages/common/constructs/src/app/index.ts', 'utf-8'),
    ).toContain("export * from './mcp-servers/index.js'");
  });

  it('should update shared constructs build dependencies for BedrockAgentCoreRuntime', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    const sharedConstructsConfig = JSON.parse(
      tree.read('packages/common/constructs/project.json', 'utf-8'),
    );

    expect(sharedConstructsConfig.targets.build.dependsOn).toContain(
      'test-project:build',
    );
  });

  it('should generate correct docker image tag for BedrockAgentCoreRuntime', async () => {
    // Update root package.json to have a scope
    const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    rootPackageJson.name = '@my-scope/workspace';
    tree.write('package.json', JSON.stringify(rootPackageJson, null, 2));

    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'my-server',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    expect(
      tree.read(
        'packages/common/constructs/src/app/mcp-servers/my-server/Dockerfile',
        'utf-8',
      ),
    ).toContain('my-scope-my-server:latest');

    // Check that the docker image tag is correctly generated in the MCP server construct
    const mcpServerConstruct = tree.read(
      'packages/common/constructs/src/app/mcp-servers/my-server/my-server.ts',
      'utf-8',
    );
    expect(mcpServerConstruct).toContain(
      'docker inspect my-scope-my-server:latest',
    );
  });

  it('should match snapshot for BedrockAgentCoreRuntime generated constructs files', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'snapshot-bedrock-server',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Snapshot the generated agent-core runtime construct
    const runtimeContent = tree.read(
      'packages/common/constructs/src/core/agent-core/runtime.ts',
      'utf-8',
    );
    expect(runtimeContent).toMatchSnapshot('agent-core-runtime.ts');

    // Snapshot the generated MCP server construct
    const mcpServerContent = tree.read(
      'packages/common/constructs/src/app/mcp-servers/snapshot-bedrock-server/snapshot-bedrock-server.ts',
      'utf-8',
    );
    expect(mcpServerContent).toMatchSnapshot('mcp-server-construct.ts');

    // Snapshot the MCP servers index file
    const mcpServersIndexContent = tree.read(
      'packages/common/constructs/src/app/mcp-servers/index.ts',
      'utf-8',
    );
    expect(mcpServersIndexContent).toMatchSnapshot('mcp-servers-index.ts');

    // Snapshot the core index file
    const coreIndexContent = tree.read(
      'packages/common/constructs/src/core/index.ts',
      'utf-8',
    );
    expect(coreIndexContent).toMatchSnapshot('core-index.ts');

    // Snapshot the app index file
    const appIndexContent = tree.read(
      'packages/common/constructs/src/app/index.ts',
      'utf-8',
    );
    expect(appIndexContent).toMatchSnapshot('app-index.ts');
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    expectHasMetricTags(tree, TS_MCP_SERVER_GENERATOR_INFO.metric);
  });

  it('should generate MCP server with Terraform provider and default name', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Terraform',
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

    // Dockerfile should be included for BedrockAgentCoreRuntime
    expect(
      tree.exists('apps/test-project/src/mcp-server/Dockerfile'),
    ).toBeTruthy();

    // Check that Terraform files were generated
    expect(
      tree.exists('packages/common/terraform/src/core/agent-core/runtime.tf'),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/terraform/src/app/mcp-servers/test-project-mcp-server/test-project-mcp-server.tf',
      ),
    ).toBeTruthy();

    // Check that shared terraform project configuration was updated with build dependency
    const sharedTerraformConfig = JSON.parse(
      tree.read('packages/common/terraform/project.json', 'utf-8'),
    );
    expect(sharedTerraformConfig.targets.build.dependsOn).toContain(
      'test-project:build',
    );
  });

  it('should generate MCP server with Terraform provider and custom name', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'custom-terraform-server',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Terraform',
    });

    // Check that MCP server files were added with custom name
    expect(
      tree.exists('apps/test-project/src/custom-terraform-server/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/custom-terraform-server/server.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/custom-terraform-server/stdio.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/custom-terraform-server/http.ts'),
    ).toBeTruthy();

    // Dockerfile should be included for BedrockAgentCoreRuntime
    expect(
      tree.exists('apps/test-project/src/custom-terraform-server/Dockerfile'),
    ).toBeTruthy();

    // Check that Terraform files were generated with custom name
    expect(
      tree.exists('packages/common/terraform/src/core/agent-core/runtime.tf'),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/terraform/src/app/mcp-servers/custom-terraform-server/custom-terraform-server.tf',
      ),
    ).toBeTruthy();
  });

  it('should match snapshot for Terraform generated files', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'terraform-snapshot-server',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Terraform',
    });

    // Snapshot the generated Terraform core runtime file
    const terraformRuntimeContent = tree.read(
      'packages/common/terraform/src/core/agent-core/runtime.tf',
      'utf-8',
    );
    expect(terraformRuntimeContent).toMatchSnapshot(
      'terraform-agent-core-runtime.tf',
    );

    // Snapshot the generated MCP server Terraform file
    const mcpServerTerraformContent = tree.read(
      'packages/common/terraform/src/app/mcp-servers/terraform-snapshot-server/terraform-snapshot-server.tf',
      'utf-8',
    );
    expect(mcpServerTerraformContent).toMatchSnapshot(
      'terraform-mcp-server.tf',
    );
  });

  it('should generate correct docker image tag for Terraform provider', async () => {
    // Update root package.json to have a scope
    const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    rootPackageJson.name = '@terraform-scope/workspace';
    tree.write('package.json', JSON.stringify(rootPackageJson, null, 2));

    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'terraform-server',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Terraform',
    });

    // Check that the docker image tag is correctly generated in the Terraform file
    const mcpServerTerraform = tree.read(
      'packages/common/terraform/src/app/mcp-servers/terraform-server/terraform-server.tf',
      'utf-8',
    );
    expect(mcpServerTerraform).toContain(
      'terraform-scope-terraform-server:latest',
    );
  });

  it('should not generate Terraform files when computeType is None', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'None',
      iacProvider: 'Terraform',
    });

    // Check that MCP server files were added
    expect(
      tree.exists('apps/test-project/src/mcp-server/index.ts'),
    ).toBeTruthy();

    // There should be no Dockerfile since the computeType is None
    expect(
      tree.exists('apps/test-project/src/mcp-server/Dockerfile'),
    ).toBeFalsy();

    // Terraform files should not be generated for None compute type
    expect(
      tree.exists('packages/common/terraform/src/core/agent-core/runtime.tf'),
    ).toBeFalsy();
    expect(
      tree.exists(
        'packages/common/terraform/src/app/mcp-servers/test-project-mcp-server/test-project-mcp-server.tf',
      ),
    ).toBeFalsy();
  });

  it('should inherit iacProvider from config when set to Inherit', async () => {
    // Set up config with Terraform provider using utility methods
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, {
      iac: {
        provider: 'Terraform',
      },
    });

    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Inherit',
    });

    // Verify Terraform files are created (not CDK constructs)
    expect(tree.exists('packages/common/terraform')).toBeTruthy();
    expect(tree.exists('packages/common/constructs')).toBeFalsy();
    expect(
      tree.exists('packages/common/terraform/src/core/agent-core/runtime.tf'),
    ).toBeTruthy();
  });

  it('should create rolldown config file for BedrockAgentCoreRuntime', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Check rolldown config file was created
    expect(tree.exists('apps/test-project/rolldown.config.ts')).toBeTruthy();

    const rolldownConfig = tree.read(
      'apps/test-project/rolldown.config.ts',
      'utf-8',
    );
    expect(rolldownConfig).toContain('defineConfig');
    expect(rolldownConfig).toContain('src/mcp-server/http.ts');
    expect(rolldownConfig).toContain(
      '../../dist/apps/test-project/bundle/mcp/test-project-mcp-server/index.js',
    );
    // Tree shaking should be disabled for the AWS SDK
    expect(rolldownConfig).toContain('disableTreeShake([/@aws-sdk\\/.*/])');
  });

  it('should ensure Dockerfile COPY path matches bundle output path', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'path-test-server',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Check Dockerfile COPY path
    const dockerfile = tree.read(
      'apps/test-project/src/path-test-server/Dockerfile',
      'utf-8',
    );
    expect(dockerfile).toContain(
      'COPY --from=workspace dist/apps/test-project/bundle/mcp/path-test-server/index.js /app',
    );

    // Check rolldown config output path matches
    const rolldownConfig = tree.read(
      'apps/test-project/rolldown.config.ts',
      'utf-8',
    );
    expect(rolldownConfig).toContain(
      '../../dist/apps/test-project/bundle/mcp/path-test-server/index.js',
    );
  });

  it('should handle multiple MCP servers without clashing', async () => {
    // Generate first MCP server
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'first-server',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Generate second MCP server
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'second-server',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Check both MCP server directories exist
    expect(
      tree.exists('apps/test-project/src/first-server/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/second-server/index.ts'),
    ).toBeTruthy();

    // Check rolldown config contains both servers
    const rolldownConfig = tree.read(
      'apps/test-project/rolldown.config.ts',
      'utf-8',
    );
    expect(rolldownConfig).toContain('src/first-server/http.ts');
    expect(rolldownConfig).toContain('src/second-server/http.ts');
    expect(rolldownConfig).toContain(
      '../../dist/apps/test-project/bundle/mcp/first-server/index.js',
    );
    expect(rolldownConfig).toContain(
      '../../dist/apps/test-project/bundle/mcp/second-server/index.js',
    );

    // Check both package.json bin entries exist
    const packageJson = JSON.parse(
      tree.read('apps/test-project/package.json', 'utf-8'),
    );
    expect(packageJson.bin['first-server']).toBe('./src/first-server/stdio.js');
    expect(packageJson.bin['second-server']).toBe(
      './src/second-server/stdio.js',
    );

    // Check both CDK constructs exist
    expect(
      tree.exists(
        'packages/common/constructs/src/app/mcp-servers/first-server/first-server.ts',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/constructs/src/app/mcp-servers/second-server/second-server.ts',
      ),
    ).toBeTruthy();

    // Check mcp-servers index exports both
    const mcpServersIndex = tree.read(
      'packages/common/constructs/src/app/mcp-servers/index.ts',
      'utf-8',
    );
    expect(mcpServersIndex).toContain(
      "export * from './first-server/first-server.js';",
    );
    expect(mcpServersIndex).toContain(
      "export * from './second-server/second-server.js';",
    );

    // Check both docker targets exist
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['first-server-docker']).toBeDefined();
    expect(projectConfig.targets['second-server-docker']).toBeDefined();
  });

  it('should add component generator metadata with default name', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata).toBeDefined();
    expect(projectConfig.metadata.components).toBeDefined();
    expect(projectConfig.metadata.components).toHaveLength(1);
    expect(projectConfig.metadata.components[0].generator).toBe(
      TS_MCP_SERVER_GENERATOR_INFO.id,
    );
    expect(projectConfig.metadata.components[0].name).toBe('mcp-server');
    expect(projectConfig.metadata.components[0].port).toBeDefined();
    expect(typeof projectConfig.metadata.components[0].port).toBe('number');
  });

  it('should add component generator metadata with custom name', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'custom-server',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata).toBeDefined();
    expect(projectConfig.metadata.components).toBeDefined();
    expect(projectConfig.metadata.components).toHaveLength(1);
    expect(projectConfig.metadata.components[0].generator).toBe(
      TS_MCP_SERVER_GENERATOR_INFO.id,
    );
    expect(projectConfig.metadata.components[0].name).toBe('custom-server');
    expect(projectConfig.metadata.components[0].port).toBeDefined();
  });
});
