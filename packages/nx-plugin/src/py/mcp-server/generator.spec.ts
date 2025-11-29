/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, Tree, writeJson } from '@nx/devkit';
import {
  pyMcpServerGenerator,
  PY_MCP_SERVER_GENERATOR_INFO,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { parse } from '@iarna/toml';
import { UVPyprojectToml } from '@nxlv/python/src/provider/uv/types';
import { joinPathFragments } from '@nx/devkit';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils';

describe('py#mcp-server generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();

    // Create an existing Python project
    addProjectConfiguration(tree, 'test-project', {
      root: 'apps/test-project',
      sourceRoot: 'apps/test-project/proj_test_project',
      targets: {
        build: {
          executor: '@nxlv/python:build',
          options: {
            outputPath: 'dist/apps/test-project',
          },
        },
      },
    });

    // Create pyproject.toml for the project
    tree.write(
      'apps/test-project/pyproject.toml',
      `[project]
name = "proj.test_project"
version = "0.1.0"
dependencies = []

[dependency-groups]
dev = []

[tool.uv]
dev-dependencies = []
`,
    );
  });

  it('should add MCP server to existing Python project with default name', async () => {
    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    // Check that MCP server files were added to the existing project
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/__init__.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/server.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/stdio.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/http.py'),
    ).toBeTruthy();

    // There should be no Dockerfile since the computeType is None
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/Dockerfile'),
    ).toBeFalsy();

    // Check that pyproject.toml was updated with MCP dependency
    const pyprojectToml = parse(
      tree.read('apps/test-project/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;
    expect(
      pyprojectToml.project.dependencies.some((dep) => dep.startsWith('mcp==')),
    ).toBe(true);

    // Check root package.json dependencies for inspector
    const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(
      rootPackageJson.devDependencies['@modelcontextprotocol/inspector'],
    ).toBeDefined();

    // Check that project configuration was updated with serve targets
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['mcp-server-serve-stdio']).toBeDefined();
    expect(projectConfig.targets['mcp-server-serve-stdio'].executor).toBe(
      'nx:run-commands',
    );
    expect(
      projectConfig.targets['mcp-server-serve-stdio'].options.commands,
    ).toEqual(['uv run -m proj_test_project.mcp_server.stdio']);

    expect(projectConfig.targets['mcp-server-serve']).toBeDefined();
    expect(projectConfig.targets['mcp-server-serve'].executor).toBe(
      'nx:run-commands',
    );
    expect(projectConfig.targets['mcp-server-serve'].options.commands).toEqual([
      'uv run -m proj_test_project.mcp_server.http',
    ]);

    expect(projectConfig.targets['mcp-server-inspect']).toBeDefined();
    expect(projectConfig.targets['mcp-server-inspect'].executor).toBe(
      'nx:run-commands',
    );
    expect(
      projectConfig.targets['mcp-server-inspect'].options.commands,
    ).toEqual([
      'mcp-inspector -- uv run -m proj_test_project.mcp_server.stdio',
    ]);
  });

  it('should add MCP server with custom name', async () => {
    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'custom-server',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    // Check that MCP server files were added with custom name
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_server/__init__.py',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_server/server.py',
      ),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/custom_server/stdio.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/custom_server/http.py'),
    ).toBeTruthy();

    // Check that project configuration was updated with custom serve targets
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['custom-server-serve-stdio']).toBeDefined();
    expect(projectConfig.targets['custom-server-serve']).toBeDefined();
    expect(projectConfig.targets['custom-server-inspect']).toBeDefined();
    expect(
      projectConfig.targets['custom-server-serve-stdio'].options.commands,
    ).toEqual(['uv run -m proj_test_project.custom_server.stdio']);
    expect(
      projectConfig.targets['custom-server-inspect'].options.commands,
    ).toEqual([
      'mcp-inspector -- uv run -m proj_test_project.custom_server.stdio',
    ]);
  });

  it('should handle kebab-case conversion for names with special characters', async () => {
    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'My_Special#Server!',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    // Name should be converted to snake_case for Python modules
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/my_special_server/__init__.py',
      ),
    ).toBeTruthy();

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(
      projectConfig.targets['my-special-server-serve-stdio'],
    ).toBeDefined();
  });

  it('should throw error for project without pyproject.toml', async () => {
    // Create project without pyproject.toml
    addProjectConfiguration(tree, 'non-py-project', {
      root: 'apps/non-py-project',
      sourceRoot: 'apps/non-py-project/src',
    });

    await expect(
      pyMcpServerGenerator(tree, {
        project: 'non-py-project',
        computeType: 'None',
        iacProvider: 'CDK',
      }),
    ).rejects.toThrow();
  });

  it('should throw error for project without sourceRoot', async () => {
    // Create project without sourceRoot
    addProjectConfiguration(tree, 'no-source-root', {
      root: 'apps/no-source-root',
      targets: {
        build: {
          executor: '@nxlv/python:build',
        },
      },
    });

    // Create pyproject.toml
    tree.write('apps/no-source-root/pyproject.toml', '{}');

    await expect(
      pyMcpServerGenerator(tree, {
        project: 'no-source-root',
        computeType: 'None',
        iacProvider: 'CDK',
      }),
    ).rejects.toThrow(
      'This project does not have a source root. Please add a source root to the project configuration before running this generator.',
    );
  });

  it('should handle nested project names correctly', async () => {
    // Create a project with nested name
    addProjectConfiguration(tree, 'proj.nested-project', {
      root: 'libs/nested-project',
      sourceRoot: 'libs/nested-project/proj_nested_project',
    });

    tree.write(
      'libs/nested-project/pyproject.toml',
      `[project]
name = "proj.nested_project"
version = "0.1.0"
dependencies = []

[dependency-groups]
dev = []

[tool.uv]
dev-dependencies = []
`,
    );

    await pyMcpServerGenerator(tree, {
      project: 'proj.nested-project',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    // Should use the last part of the project name for default server name
    expect(
      tree.exists(
        'libs/nested-project/proj_nested_project/mcp_server/__init__.py',
      ),
    ).toBeTruthy();

    const projectConfig = JSON.parse(
      tree.read('libs/nested-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['mcp-server-serve-stdio']).toBeDefined();
  });

  it('should match snapshot for generated files', async () => {
    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'snapshot-server',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    // Snapshot the generated MCP server files
    const initContent = tree.read(
      'apps/test-project/proj_test_project/snapshot_server/__init__.py',
      'utf-8',
    );
    const serverContent = tree.read(
      'apps/test-project/proj_test_project/snapshot_server/server.py',
      'utf-8',
    );
    const stdioContent = tree.read(
      'apps/test-project/proj_test_project/snapshot_server/stdio.py',
      'utf-8',
    );
    const httpContent = tree.read(
      'apps/test-project/proj_test_project/snapshot_server/http.py',
      'utf-8',
    );

    expect(initContent).toMatchSnapshot('mcp-server-__init__.py');
    expect(serverContent).toMatchSnapshot('mcp-server-server.py');
    expect(stdioContent).toMatchSnapshot('mcp-server-stdio.py');
    expect(httpContent).toMatchSnapshot('mcp-server-http.py');

    // Snapshot the updated pyproject.toml
    const pyprojectToml = tree.read(
      'apps/test-project/pyproject.toml',
      'utf-8',
    );
    expect(pyprojectToml).toMatchSnapshot('updated-pyproject.toml');
  });

  it('should generate MCP server with BedrockAgentCoreRuntime and default name', async () => {
    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Check that MCP server files were added to the existing project
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/__init__.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/server.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/stdio.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/http.py'),
    ).toBeTruthy();

    // Dockerfile should be included for BedrockAgentCoreRuntime
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/Dockerfile'),
    ).toBeTruthy();

    // Check that pyproject.toml was updated with MCP dependency
    const pyprojectToml = parse(
      tree.read('apps/test-project/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;
    expect(
      pyprojectToml.project.dependencies.some((dep) => dep.startsWith('mcp==')),
    ).toBe(true);

    // Check that project configuration was updated with serve targets
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['mcp-server-serve-stdio']).toBeDefined();
    expect(projectConfig.targets['mcp-server-serve']).toBeDefined();

    // Check that bundle target was added
    expect(projectConfig.targets['bundle-arm']).toBeDefined();

    // Check that docker target was added
    expect(projectConfig.targets['mcp-server-docker']).toBeDefined();
    expect(projectConfig.targets['mcp-server-docker'].executor).toBe(
      'nx:run-commands',
    );
    expect(projectConfig.targets['mcp-server-docker'].options.commands).toEqual(
      [
        'docker build --platform linux/arm64 -t proj-test-project-mcp-server:latest apps/test-project/proj_test_project/mcp_server --build-context workspace=.',
      ],
    );

    // Check that docker target depends on bundle-arm
    expect(projectConfig.targets['mcp-server-docker'].dependsOn).toContain(
      'bundle-arm',
    );

    // Check that build target depends on docker
    expect(projectConfig.targets.build.dependsOn).toContain('docker');
  });

  it('should generate MCP server with BedrockAgentCoreRuntime and custom name', async () => {
    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'custom-bedrock-server',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Check that MCP server files were added with custom name
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_bedrock_server/__init__.py',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_bedrock_server/server.py',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_bedrock_server/stdio.py',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_bedrock_server/http.py',
      ),
    ).toBeTruthy();

    // Dockerfile should be included for BedrockAgentCoreRuntime
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_bedrock_server/Dockerfile',
      ),
    ).toBeTruthy();

    // Check that project configuration was updated with custom serve targets
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(
      projectConfig.targets['custom-bedrock-server-serve-stdio'],
    ).toBeDefined();
    expect(projectConfig.targets['custom-bedrock-server-serve']).toBeDefined();

    // Check that docker target was added with custom name
    expect(projectConfig.targets['custom-bedrock-server-docker']).toBeDefined();
  });

  it('should add additional dependencies for BedrockAgentCoreRuntime', async () => {
    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Check root package.json dependencies
    const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(
      rootPackageJson.devDependencies['@modelcontextprotocol/inspector'],
    ).toBeDefined();
    expect(
      rootPackageJson.devDependencies['@aws-cdk/aws-bedrock-agentcore-alpha'],
    ).toBeDefined();

    // Check that pyproject.toml was updated with MCP dependency
    const pyprojectToml = parse(
      tree.read('apps/test-project/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;
    expect(
      pyprojectToml.project.dependencies.some((dep) => dep.startsWith('mcp==')),
    ).toBe(true);
  });

  it('should generate shared constructs for BedrockAgentCoreRuntime', async () => {
    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
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
    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    const sharedConstructsConfig = JSON.parse(
      tree.read(
        joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'project.json'),
        'utf-8',
      ),
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

    await pyMcpServerGenerator(tree, {
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
    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'snapshot-bedrock-server',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
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

  it('should handle Python bundle target configuration for BedrockAgentCoreRuntime', async () => {
    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    // Check that bundle target was configured with Python-specific options
    expect(projectConfig.targets['bundle-arm']).toBeDefined();
    expect(projectConfig.targets['bundle-arm'].executor).toBe(
      'nx:run-commands',
    );

    // Check the exact commands for the bundle target
    const commands = projectConfig.targets['bundle-arm'].options.commands;
    expect(commands).toEqual([
      'uv export --frozen --no-dev --no-editable --project apps/test-project --package test-project -o dist/apps/test-project/bundle-arm/requirements.txt',
      'uv pip install -n --no-deps --no-installer-metadata --no-compile-bytecode --python-platform aarch64-manylinux2014 --target dist/apps/test-project/bundle-arm -r dist/apps/test-project/bundle-arm/requirements.txt',
    ]);
  });

  it('should handle module name extraction correctly', async () => {
    // Create a project with different source root structure
    addProjectConfiguration(tree, 'complex-project', {
      root: 'apps/complex-project',
      sourceRoot: 'apps/complex-project/src/my_complex_module',
      targets: {
        build: {
          executor: '@nxlv/python:build',
        },
      },
    });

    tree.write(
      'apps/complex-project/pyproject.toml',
      `[project]
name = "proj.complex_project"
version = "0.1.0"
dependencies = []

[dependency-groups]
dev = []

[tool.uv]
dev-dependencies = []
`,
    );

    await pyMcpServerGenerator(tree, {
      project: 'complex-project',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    // Check that the module name is extracted correctly from the source root
    const projectConfig = JSON.parse(
      tree.read('apps/complex-project/project.json', 'utf-8'),
    );
    expect(
      projectConfig.targets['mcp-server-serve-stdio'].options.commands,
    ).toEqual(['uv run -m my_complex_module.mcp_server.stdio']);
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    expectHasMetricTags(tree, PY_MCP_SERVER_GENERATOR_INFO.metric);
  });

  it('should handle docker target dependencies correctly for BedrockAgentCoreRuntime', async () => {
    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    // Check that the specific docker target was created
    const dockerTargetName = 'mcp-server-docker';
    expect(projectConfig.targets[dockerTargetName]).toBeDefined();
    expect(projectConfig.targets[dockerTargetName].dependsOn).toContain(
      'bundle-arm',
    );

    // Check that the general docker target includes the specific docker target
    expect(projectConfig.targets.docker).toBeDefined();
    expect(projectConfig.targets.docker.dependsOn).toContain(dockerTargetName);

    // Check that build target depends on docker
    expect(projectConfig.targets.build.dependsOn).toContain('docker');
  });

  it('should generate MCP server with Terraform provider and default name', async () => {
    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Terraform',
    });

    // Check that MCP server files were added to the existing project
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/__init__.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/server.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/stdio.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/http.py'),
    ).toBeTruthy();

    // Dockerfile should be included for BedrockAgentCoreRuntime
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/Dockerfile'),
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
    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      name: 'custom-terraform-server',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Terraform',
    });

    // Check that MCP server files were added with custom name
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_terraform_server/__init__.py',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_terraform_server/server.py',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_terraform_server/stdio.py',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_terraform_server/http.py',
      ),
    ).toBeTruthy();

    // Dockerfile should be included for BedrockAgentCoreRuntime
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_terraform_server/Dockerfile',
      ),
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
    await pyMcpServerGenerator(tree, {
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

    await pyMcpServerGenerator(tree, {
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
    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'None',
      iacProvider: 'Terraform',
    });

    // Check that MCP server files were added
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/__init__.py'),
    ).toBeTruthy();

    // There should be no Dockerfile since the computeType is None
    expect(
      tree.exists('apps/test-project/proj_test_project/mcp_server/Dockerfile'),
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

  it('should handle Python bundle target configuration for Terraform provider', async () => {
    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Terraform',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    // Check that bundle target was configured with Python-specific options
    expect(projectConfig.targets['bundle-arm']).toBeDefined();
    expect(projectConfig.targets['bundle-arm'].executor).toBe(
      'nx:run-commands',
    );

    // Check the exact commands for the bundle target
    const commands = projectConfig.targets['bundle-arm'].options.commands;
    expect(commands).toEqual([
      'uv export --frozen --no-dev --no-editable --project apps/test-project --package test-project -o dist/apps/test-project/bundle-arm/requirements.txt',
      'uv pip install -n --no-deps --no-installer-metadata --no-compile-bytecode --python-platform aarch64-manylinux2014 --target dist/apps/test-project/bundle-arm -r dist/apps/test-project/bundle-arm/requirements.txt',
    ]);

    // Check that docker target was added
    expect(projectConfig.targets['mcp-server-docker']).toBeDefined();
    expect(projectConfig.targets['mcp-server-docker'].dependsOn).toContain(
      'bundle-arm',
    );
  });

  it('should inherit iacProvider from config when set to Inherit', async () => {
    // Set up config with CDK provider using utility methods
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, {
      iac: {
        provider: 'CDK',
      },
    });

    await pyMcpServerGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Inherit',
    });

    // Verify CDK constructs are created (not terraform)
    expect(tree.exists('packages/common/constructs')).toBeTruthy();
    expect(tree.exists('packages/common/terraform')).toBeFalsy();
  });

  it('should add component generator metadata with default name', async () => {
    await pyMcpServerGenerator(tree, {
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
      PY_MCP_SERVER_GENERATOR_INFO.id,
    );
    expect(projectConfig.metadata.components[0].name).toBe('mcp-server');
    expect(projectConfig.metadata.components[0].port).toBeDefined();
    expect(typeof projectConfig.metadata.components[0].port).toBe('number');
  });

  it('should add component generator metadata with custom name', async () => {
    await pyMcpServerGenerator(tree, {
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
      PY_MCP_SERVER_GENERATOR_INFO.id,
    );
    expect(projectConfig.metadata.components[0].name).toBe('custom-server');
    expect(projectConfig.metadata.components[0].port).toBeDefined();
  });
});
