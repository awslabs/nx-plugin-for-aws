/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import * as devkit from '@nx/devkit';
import {
  addProjectConfiguration,
  type Tree,
  updateJson,
  writeJson,
} from '@nx/devkit';
import { vi } from 'vitest';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { CONTAINER_VERSIONS } from '../../utils/versions';
import {
  TS_MCP_SERVER_GENERATOR_INFO,
  tsMcpServerGenerator,
} from './generator';

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
  });

  it('should add MCP server to existing TypeScript project with default name', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
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

    // There should be no Dockerfile since the infra is none
    expect(
      tree.exists('apps/test-project/src/mcp-server/Dockerfile'),
    ).toBeFalsy();

    // The generator should not vend a nested project package.json
    expect(tree.exists('apps/test-project/package.json')).toBeFalsy();

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
    expect(projectConfig.targets['mcp-server-inspect'].dependsOn).toContain(
      'mcp-server-dev',
    );
    expect(
      projectConfig.targets['mcp-server-inspect'].options.commands[0],
    ).toContain(
      'mcp-inspector --transport http --server-url http://localhost:',
    );
    expect(
      projectConfig.targets['mcp-server-inspect-stdio'].options.commands[0],
    ).toContain('mcp-inspector -- tsx --watch ./src/mcp-server/stdio.ts');

    // <mcp>-dev is the runner; the first component also adds a project-level
    // dev aggregating it.
    expect(projectConfig.targets['mcp-server-dev'].executor).toBe(
      'nx:run-commands',
    );
    expect(projectConfig.targets['mcp-server-dev'].continuous).toBe(true);
    expect(projectConfig.targets['mcp-server-dev'].options.env).toEqual({
      PORT: expect.any(String),
      LOCAL_DEV: 'true',
    });
    expect(projectConfig.targets['dev']).toEqual({
      continuous: true,
      dependsOn: ['mcp-server-dev'],
    });
  });

  it('should add MCP server with custom name', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'custom-server',
      infra: 'none',
      iac: 'cdk',
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

    // The generator should not vend a nested project package.json
    expect(tree.exists('apps/test-project/package.json')).toBeFalsy();

    // Check that project configuration was updated with custom serve target
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['custom-server-serve-stdio']).toBeDefined();
    expect(projectConfig.targets['custom-server-serve']).toBeDefined();
    expect(projectConfig.targets['custom-server-inspect']).toBeDefined();
    expect(projectConfig.targets['custom-server-inspect'].dependsOn).toContain(
      'custom-server-dev',
    );
    expect(
      projectConfig.targets['custom-server-inspect'].options.commands[0],
    ).toContain(
      'mcp-inspector --transport http --server-url http://localhost:',
    );
    expect(
      projectConfig.targets['custom-server-inspect-stdio'].options.commands[0],
    ).toContain('mcp-inspector -- tsx --watch ./src/custom-server/stdio.ts');
  });

  it('should handle ESM projects correctly', async () => {
    // The module system is derived from the workspace root package.json
    updateJson(tree, 'package.json', (pkg) => ({ ...pkg, type: 'module' }));

    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'esm-server',
      infra: 'none',
      iac: 'cdk',
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
    // A CommonJS workspace is marked with an explicit type: 'commonjs'
    updateJson(tree, 'package.json', (pkg) => ({ ...pkg, type: 'commonjs' }));

    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'cjs-server',
      infra: 'none',
      iac: 'cdk',
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

  it('should not create a nested project package.json', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'new-server',
      infra: 'none',
      iac: 'cdk',
    });

    // The generator relies on the workspace root package.json rather than
    // vending a nested one for the project
    expect(tree.exists('apps/test-project/package.json')).toBeFalsy();
  });

  it('should add dependencies to the workspace root package.json', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
    });

    // Check root package.json dependencies
    const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(
      rootPackageJson.dependencies['@modelcontextprotocol/sdk'],
    ).toBeDefined();
    expect(rootPackageJson.dependencies['zod']).toBeDefined();
    expect(rootPackageJson.dependencies['express']).toBeDefined();
    expect(rootPackageJson.devDependencies['tsx']).toBeDefined();
    expect(rootPackageJson.devDependencies['@types/express']).toBeDefined();
    expect(
      rootPackageJson.devDependencies['@modelcontextprotocol/inspector'],
    ).toBeDefined();

    // No nested project package.json should be created
    expect(tree.exists('apps/test-project/package.json')).toBeFalsy();
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
      infra: 'none',
      iac: 'cdk',
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
      infra: 'none',
      iac: 'cdk',
    });

    // Name should be converted to kebab-case
    expect(
      tree.exists('apps/test-project/src/my-special-server/index.ts'),
    ).toBeTruthy();

    const serverContent = tree.read(
      'apps/test-project/src/my-special-server/server.ts',
      'utf-8',
    );
    expect(serverContent).toContain("name: 'my-special-server'");
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
        infra: 'none',
        iac: 'cdk',
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
      infra: 'none',
      iac: 'cdk',
    });

    // Should use the last part of the project name for default server name
    expect(
      tree.exists('libs/nested-project/src/mcp-server/index.ts'),
    ).toBeTruthy();

    const serverContent = tree.read(
      'libs/nested-project/src/mcp-server/server.ts',
      'utf-8',
    );
    expect(serverContent).toContain("name: 'nested-project-mcp-server'");
  });

  it('should match snapshot for generated files', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'snapshot-server',
      infra: 'none',
      iac: 'cdk',
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
  });

  it('should generate MCP server with BedrockAgentCoreRuntime and default name', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'cdk',
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

    // The generator should not vend a nested project package.json
    expect(tree.exists('apps/test-project/package.json')).toBeFalsy();

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
    expect(projectConfig.targets['mcp-server-docker'].options.commands).toEqual(
      [
        'ncp apps/test-project/src/mcp-server/Dockerfile dist/apps/test-project/bundle/mcp/test-project-mcp-server/Dockerfile',
        'docker build --platform linux/arm64 -t proj-test-project-mcp-server:latest dist/apps/test-project/bundle/mcp/test-project-mcp-server',
      ],
    );
    expect(projectConfig.targets['mcp-server-docker'].options.parallel).toBe(
      false,
    );
    expect(projectConfig.targets['mcp-server-docker'].dependsOn).toEqual([
      'bundle',
    ]);
    expect(projectConfig.targets['mcp-server-docker'].outputs).toEqual([
      '{workspaceRoot}/dist/apps/test-project/bundle/mcp/test-project-mcp-server/Dockerfile',
    ]);

    // Check that a cacheable trivy scan target was added
    expect(projectConfig.targets['mcp-server-trivy']).toEqual({
      cache: true,
      inputs: ['default', '^production'],
      outputs: [
        '{workspaceRoot}/dist/apps/test-project/trivy/proj-test-project-mcp-server-latest',
      ],
      executor: 'nx:run-commands',
      options: {
        commands: [
          'rimraf dist/apps/test-project/trivy/proj-test-project-mcp-server-latest',
          'make-dir dist/apps/test-project/trivy/proj-test-project-mcp-server-latest',
          'ncp apps/test-project/.trivyignore dist/apps/test-project/trivy/proj-test-project-mcp-server-latest/.trivyignore',
          'docker save -o dist/apps/test-project/trivy/proj-test-project-mcp-server-latest/image-0.tar proj-test-project-mcp-server:latest',
          `docker run --rm -v "./dist/apps/test-project/trivy/proj-test-project-mcp-server-latest":/scan public.ecr.aws/aquasecurity/trivy:${CONTAINER_VERSIONS.trivy} image --input /scan/image-0.tar --ignorefile /scan/.trivyignore --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --no-progress -q`,
        ],
        parallel: false,
      },
      dependsOn: ['mcp-server-docker'],
    });
    expect(projectConfig.targets['trivy'].dependsOn).toContain(
      'mcp-server-trivy',
    );
    expect(projectConfig.targets['build'].dependsOn).toContain('trivy');
  });

  it('should generate MCP server with BedrockAgentCoreRuntime and custom name', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'custom-bedrock-server',
      infra: 'agentcore',
      iac: 'cdk',
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

    // The generator should not vend a nested project package.json
    expect(tree.exists('apps/test-project/package.json')).toBeFalsy();

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
      infra: 'agentcore',
      iac: 'cdk',
    });

    // Check root package.json dependencies
    const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(
      rootPackageJson.dependencies['@modelcontextprotocol/sdk'],
    ).toBeDefined();
    expect(rootPackageJson.dependencies['zod']).toBeDefined();
    expect(rootPackageJson.dependencies['express']).toBeDefined();
    expect(rootPackageJson.devDependencies['tsx']).toBeDefined();
    expect(rootPackageJson.devDependencies['@types/express']).toBeDefined();

    // Additional dependencies for BedrockAgentCoreRuntime
    expect(rootPackageJson.devDependencies['rolldown']).toBeDefined();
    expect(
      rootPackageJson.devDependencies['@modelcontextprotocol/inspector'],
    ).toBeDefined();

    // No nested project package.json should be created
    expect(tree.exists('apps/test-project/package.json')).toBeFalsy();
  });

  it('should generate shared constructs for BedrockAgentCoreRuntime', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'cdk',
    });

    // Verify shared constructs setup
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
      infra: 'agentcore',
      iac: 'cdk',
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
      infra: 'agentcore',
      iac: 'cdk',
    });

    // Check that the MCP server construct uses findWorkspaceRoot to locate the bundle
    const mcpServerConstruct = tree.read(
      'packages/common/constructs/src/app/mcp-servers/my-server/my-server.ts',
      'utf-8',
    );
    expect(mcpServerConstruct).toContain('findWorkspaceRoot');
  });

  it('should match snapshot for BedrockAgentCoreRuntime generated constructs files', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'snapshot-bedrock-server',
      infra: 'agentcore',
      iac: 'cdk',
    });

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
    await sharedConstructsGenerator(tree, { iac: 'cdk' });

    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
    });

    expectHasMetricTags(tree, TS_MCP_SERVER_GENERATOR_INFO.metric);
  });

  it('should generate MCP server with Terraform provider and default name', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'terraform',
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
      infra: 'agentcore',
      iac: 'terraform',
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
      infra: 'agentcore',
      iac: 'terraform',
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
      infra: 'agentcore',
      iac: 'terraform',
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

  it('should not generate Terraform files when infra is none', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'terraform',
    });

    // Check that MCP server files were added
    expect(
      tree.exists('apps/test-project/src/mcp-server/index.ts'),
    ).toBeTruthy();

    // There should be no Dockerfile since the infra is none
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

  it('should inherit iac from config when set to Inherit', async () => {
    // Set up config with Terraform provider using utility methods
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, {
      iac: {
        provider: 'terraform',
      },
    });

    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'inherit',
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
      infra: 'agentcore',
      iac: 'cdk',
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
  });

  it('should ensure Dockerfile COPY path matches bundle output path', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'path-test-server',
      infra: 'agentcore',
      iac: 'cdk',
    });

    // Check Dockerfile COPY path
    const dockerfile = tree.read(
      'apps/test-project/src/path-test-server/Dockerfile',
      'utf-8',
    );
    expect(dockerfile).toContain('COPY index.js /app');

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
      infra: 'agentcore',
      iac: 'cdk',
    });

    // Generate second MCP server
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'second-server',
      infra: 'agentcore',
      iac: 'cdk',
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

    // Both server directories should be generated
    expect(
      tree.exists('apps/test-project/src/first-server/server.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/second-server/server.ts'),
    ).toBeTruthy();

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

  it('should be idempotent when re-run with same options', async () => {
    const options = {
      project: 'test-project',
      infra: 'none' as const,
      iac: 'cdk' as const,
    };
    await tsMcpServerGenerator(tree, options);
    const firstProjectJson = tree.read(
      'apps/test-project/project.json',
      'utf-8',
    );

    await tsMcpServerGenerator(tree, options);
    const secondProjectJson = tree.read(
      'apps/test-project/project.json',
      'utf-8',
    );

    const projectConfig = JSON.parse(secondProjectJson);

    // Port metadata should not grow on re-run
    expect(projectConfig.metadata.ports).toHaveLength(1);
    // The MCP server component should not be duplicated
    expect(projectConfig.metadata.components).toHaveLength(1);

    expect(secondProjectJson).toEqual(firstProjectJson);
  });

  it('should add component generator metadata with default name', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
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
      infra: 'none',
      iac: 'cdk',
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

  it('should pin @modelcontextprotocol/sdk zod via yarn resolutions to match the workspace zod', async () => {
    vi.spyOn(devkit, 'detectPackageManager').mockReturnValue('yarn');

    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
    });

    const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(
      rootPackageJson.resolutions?.['**/@modelcontextprotocol/sdk/zod'],
    ).toBe(rootPackageJson.dependencies.zod);
  });

  it.each(['pnpm', 'npm', 'bun'] as const)(
    'should not add yarn resolutions for %s',
    async (pkgMgr) => {
      vi.spyOn(devkit, 'detectPackageManager').mockReturnValue(pkgMgr);

      await tsMcpServerGenerator(tree, {
        project: 'test-project',
        infra: 'none',
        iac: 'cdk',
      });

      const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
      expect(rootPackageJson.resolutions).toBeUndefined();
    },
  );

  it('should use default name when empty string is provided', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: '',
      infra: 'none',
      iac: 'cdk',
    });

    // Check that MCP server files were added with default name
    expect(
      tree.exists('apps/test-project/src/mcp-server/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/mcp-server/server.ts'),
    ).toBeTruthy();

    // Check that the server.ts file contains the default name
    const serverContent = tree.read(
      'apps/test-project/src/mcp-server/server.ts',
      'utf-8',
    );
    expect(serverContent).toContain("name: 'test-project-mcp-server'");

    // The generator should not vend a nested project package.json
    expect(tree.exists('apps/test-project/package.json')).toBeFalsy();

    // Check that project configuration was updated with default serve targets
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['mcp-server-serve-stdio']).toBeDefined();
    expect(projectConfig.targets['mcp-server-serve']).toBeDefined();
  });

  it('should generate with infra=none then upgrade to infra=agentcore', async () => {
    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'upgrade-mcp',
      infra: 'none',
      iac: 'cdk',
    });

    expect(
      tree.exists('apps/test-project/src/upgrade-mcp/index.ts'),
    ).toBeTruthy();
    expect(tree.exists('packages/common/constructs')).toBeFalsy();

    await tsMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'upgrade-mcp',
      infra: 'agentcore',
      iac: 'cdk',
    });

    expect(tree.exists('packages/common/constructs')).toBeTruthy();
  });
});
