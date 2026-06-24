/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { parse } from '@iarna/toml';
import {
  addProjectConfiguration,
  joinPathFragments,
  type Tree,
  writeJson,
} from '@nx/devkit';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import type { UVPyprojectToml } from '../../utils/nxlv-python';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../../utils/shared-constructs-constants';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { PY_AGENT_GENERATOR_INFO, pyAgentGenerator } from './generator';

describe('py#agent generator', () => {
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

  it('should add strands agent to existing Python project with default name', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      iac: 'cdk',
    });

    // Check that agent files were added to the existing project
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/__init__.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/agent.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/main.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/Dockerfile'),
    ).toBeTruthy();

    // The agent server imports the framework base helpers, so they must be
    // emitted + re-exported even without any connection client.
    const moduleDirs = tree.children('packages/common/agent_connection');
    const moduleName = moduleDirs.find((c) => c.includes('agent_connection'))!;
    const acBase = `packages/common/agent_connection/${moduleName}`;
    expect(
      tree.exists(`${acBase}/core/with_session_id_strands.py`),
    ).toBeTruthy();
    expect(tree.exists(`${acBase}/core/model_errors_strands.py`)).toBeTruthy();
    const acInit = tree.read(`${acBase}/__init__.py`, 'utf-8')!;
    expect(acInit).toContain('with_session_id');
    expect(acInit).toContain('log_model_errors');

    // Check that pyproject.toml was updated with strands agent dependencies
    const pyprojectToml = parse(
      tree.read('apps/test-project/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;
    expect(
      pyprojectToml.project.dependencies.some((dep) =>
        dep.startsWith('bedrock-agentcore=='),
      ),
    ).toBe(true);
    expect(
      pyprojectToml.project.dependencies.some((dep) =>
        dep.startsWith('strands-agents=='),
      ),
    ).toBe(true);
    expect(
      pyprojectToml.project.dependencies.some((dep) =>
        dep.startsWith('strands-agents-tools=='),
      ),
    ).toBe(true);

    // Check that project configuration was updated with serve target
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['agent-serve']).toBeDefined();
    expect(projectConfig.targets['agent-serve'].executor).toBe(
      'nx:run-commands',
    );
    expect(projectConfig.targets['agent-serve'].options.commands).toEqual([
      'uv run fastapi dev proj_test_project/agent/main.py --port 8081',
    ]);
    expect(projectConfig.targets['agent-serve'].continuous).toBe(true);
  });

  it('should add strands agent with custom name', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'custom-agent',
      iac: 'cdk',
    });

    // Check that agent files were added with custom name
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_agent/__init__.py',
      ),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/custom_agent/agent.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/custom_agent/main.py'),
    ).toBeTruthy();
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_agent/Dockerfile',
      ),
    ).toBeTruthy();

    // Check that project configuration was updated with custom serve target
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['custom-agent-serve']).toBeDefined();
    expect(
      projectConfig.targets['custom-agent-serve'].options.commands,
    ).toEqual([
      'uv run fastapi dev proj_test_project/custom_agent/main.py --port 8081',
    ]);
  });

  it('should handle kebab-case conversion for names with special characters', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'My_Special#Agent!',
      iac: 'cdk',
    });

    // Name should be converted to snake_case for Python modules
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/my_special_agent/__init__.py',
      ),
    ).toBeTruthy();

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['my-special-agent-serve']).toBeDefined();
  });

  it('should throw error for project without pyproject.toml', async () => {
    // Create project without pyproject.toml
    addProjectConfiguration(tree, 'non-py-project', {
      root: 'apps/non-py-project',
      sourceRoot: 'apps/non-py-project/src',
    });

    await expect(
      pyAgentGenerator(tree, {
        project: 'non-py-project',
        iac: 'cdk',
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
      pyAgentGenerator(tree, {
        project: 'no-source-root',
        iac: 'cdk',
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

    await pyAgentGenerator(tree, {
      project: 'proj.nested-project',
      iac: 'cdk',
    });

    // Should use the last part of the project name for default agent name
    expect(
      tree.exists('libs/nested-project/proj_nested_project/agent/__init__.py'),
    ).toBeTruthy();

    const projectConfig = JSON.parse(
      tree.read('libs/nested-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['agent-serve']).toBeDefined();
  });

  it('should generate strands agent with BedrockAgentCoreRuntime (default)', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'cdk',
    });

    // Check that agent files were added to the existing project
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/__init__.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/agent.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/main.py'),
    ).toBeTruthy();

    // Dockerfile should be included for BedrockAgentCoreRuntime
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/Dockerfile'),
    ).toBeTruthy();

    // Check that project configuration was updated with serve target
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['agent-serve']).toBeDefined();

    // Check that bundle target was added
    expect(projectConfig.targets['bundle-arm']).toBeDefined();

    // Check that docker target was added
    expect(projectConfig.targets['agent-docker']).toBeDefined();
    expect(projectConfig.targets['agent-docker'].executor).toBe(
      'nx:run-commands',
    );
    expect(projectConfig.targets['agent-docker'].options.commands).toEqual([
      'rimraf dist/apps/test-project/docker/test-project-agent',
      'make-dir dist/apps/test-project/docker/test-project-agent',
      'ncp dist/apps/test-project/bundle-arm dist/apps/test-project/docker/test-project-agent',
      'ncp apps/test-project/proj_test_project/agent/Dockerfile dist/apps/test-project/docker/test-project-agent/Dockerfile',
      'docker build --platform linux/arm64 -t proj-test-project-agent:latest dist/apps/test-project/docker/test-project-agent',
    ]);
    expect(projectConfig.targets['agent-docker'].options.parallel).toBe(false);

    // Check that docker target depends on bundle-arm
    expect(projectConfig.targets['agent-docker'].dependsOn).toContain(
      'bundle-arm',
    );

    // Check that build target depends on docker
    expect(projectConfig.targets.build.dependsOn).toContain('docker');
  });

  it('should generate strands agent with BedrockAgentCoreRuntime and custom name', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'custom-bedrock-agent',
      infra: 'agentcore',
      iac: 'cdk',
    });

    // Check that agent files were added with custom name
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_bedrock_agent/__init__.py',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_bedrock_agent/agent.py',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_bedrock_agent/main.py',
      ),
    ).toBeTruthy();

    // Dockerfile should be included for BedrockAgentCoreRuntime
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_bedrock_agent/Dockerfile',
      ),
    ).toBeTruthy();

    // Check that project configuration was updated with custom serve targets
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['custom-bedrock-agent-serve']).toBeDefined();

    // Check that docker target was added with custom name
    expect(projectConfig.targets['custom-bedrock-agent-docker']).toBeDefined();
  });

  it('should generate strands agent with None compute type', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
    });

    // Check that agent files were added to the existing project
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/__init__.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/agent.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/main.py'),
    ).toBeTruthy();

    // There should be no Dockerfile since the computeType is None
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/Dockerfile'),
    ).toBeFalsy();

    // Check that pyproject.toml was updated with strands agent dependencies
    const pyprojectToml = parse(
      tree.read('apps/test-project/pyproject.toml', 'utf-8'),
    ) as UVPyprojectToml;
    expect(
      pyprojectToml.project.dependencies.some((dep) =>
        dep.startsWith('bedrock-agentcore=='),
      ),
    ).toBe(true);
    expect(
      pyprojectToml.project.dependencies.some((dep) =>
        dep.startsWith('strands-agents=='),
      ),
    ).toBe(true);
    expect(
      pyprojectToml.project.dependencies.some((dep) =>
        dep.startsWith('strands-agents-tools=='),
      ),
    ).toBe(true);

    // Check that project configuration was updated with serve target only
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['agent-serve']).toBeDefined();

    // Bundle and docker targets should not be added for None compute type
    expect(projectConfig.targets['bundle-arm']).toBeUndefined();
    expect(projectConfig.targets['agent-docker']).toBeUndefined();
  });

  it('should generate shared constructs for BedrockAgentCoreRuntime', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'cdk',
    });

    // Verify shared constructs setup
    expect(
      tree.exists('packages/common/constructs/src/app/agents/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/constructs/src/app/agents/test-project-agent/test-project-agent.ts',
      ),
    ).toBeTruthy();

    // Check that the agent construct exports are added
    expect(
      tree.read('packages/common/constructs/src/app/agents/index.ts', 'utf-8'),
    ).toContain("export * from './test-project-agent/test-project-agent.js'");

    // Check that the app index exports agents
    expect(
      tree.read('packages/common/constructs/src/app/index.ts', 'utf-8'),
    ).toContain("export * from './agents/index.js'");
  });

  it('should update shared constructs build dependencies for BedrockAgentCoreRuntime', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'cdk',
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

    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'my-agent',
      infra: 'agentcore',
      iac: 'cdk',
    });

    // Check that the docker image tag is correctly generated in the agent construct
    const agentConstruct = tree.read(
      'packages/common/constructs/src/app/agents/my-agent/my-agent.ts',
      'utf-8',
    );
    expect(agentConstruct).toContain('findWorkspaceRoot');
  });

  it('should handle Python bundle target configuration for BedrockAgentCoreRuntime', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'cdk',
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
      'uv export --frozen --no-dev --no-editable --project {projectRoot} --package test-project -o dist/{projectRoot}/bundle-arm/requirements.txt',
      'uv pip install -n --no-deps --no-installer-metadata --no-compile-bytecode --python-platform aarch64-manylinux_2_28 --target dist/{projectRoot}/bundle-arm -r dist/{projectRoot}/bundle-arm/requirements.txt',
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

    await pyAgentGenerator(tree, {
      project: 'complex-project',
      infra: 'none',
      iac: 'cdk',
    });

    // Check that the module name is extracted correctly from the source root
    const projectConfig = JSON.parse(
      tree.read('apps/complex-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['agent-serve'].options.commands).toEqual([
      'uv run fastapi dev my_complex_module/agent/main.py --port 8081',
    ]);
  });

  it('should handle docker target dependencies correctly for BedrockAgentCoreRuntime', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'cdk',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    // Check that the specific docker target was created
    const dockerTargetName = 'agent-docker';
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

  it('should match snapshot for generated files', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'snapshot-agent',
      infra: 'none',
      iac: 'cdk',
    });

    // Snapshot the generated agent files
    const initContent = tree.read(
      'apps/test-project/proj_test_project/snapshot_agent/__init__.py',
      'utf-8',
    );
    const agentContent = tree.read(
      'apps/test-project/proj_test_project/snapshot_agent/agent.py',
      'utf-8',
    );
    const mainContent = tree.read(
      'apps/test-project/proj_test_project/snapshot_agent/main.py',
      'utf-8',
    );

    expect(initContent).toMatchSnapshot('agent-__init__.py');
    expect(agentContent).toMatchSnapshot('agent-agent.py');
    expect(mainContent).toMatchSnapshot('agent-main.py');

    // Snapshot the updated pyproject.toml
    const pyprojectToml = tree.read(
      'apps/test-project/pyproject.toml',
      'utf-8',
    );
    expect(pyprojectToml).toMatchSnapshot('updated-pyproject.toml');
  });

  it('should match snapshot for BedrockAgentCoreRuntime generated constructs files', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'snapshot-bedrock-agent',
      infra: 'agentcore',
      iac: 'cdk',
    });

    // Snapshot the generated agent construct
    const agentConstructContent = tree.read(
      'packages/common/constructs/src/app/agents/snapshot-bedrock-agent/snapshot-bedrock-agent.ts',
      'utf-8',
    );
    expect(agentConstructContent).toMatchSnapshot('agent-construct.ts');

    // Snapshot the agents index file
    const agentsIndexContent = tree.read(
      'packages/common/constructs/src/app/agents/index.ts',
      'utf-8',
    );
    expect(agentsIndexContent).toMatchSnapshot('agents-index.ts');

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

    // Snapshot the Dockerfile
    const dockerfileContent = tree.read(
      'apps/test-project/proj_test_project/snapshot_bedrock_agent/Dockerfile',
      'utf-8',
    );
    expect(dockerfileContent).toMatchSnapshot('agent-Dockerfile');
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree, { iac: 'cdk' });

    await pyAgentGenerator(tree, {
      project: 'test-project',
      iac: 'cdk',
    });

    expectHasMetricTags(tree, PY_AGENT_GENERATOR_INFO.metric);
  });

  it('should handle default computeType as BedrockAgentCoreRuntime', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      // No computeType specified, should default to BedrockAgentCoreRuntime
      iac: 'cdk',
    });

    // Should include Dockerfile by default
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/Dockerfile'),
    ).toBeTruthy();

    // Should have docker and bundle targets
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['bundle-arm']).toBeDefined();
    expect(projectConfig.targets['agent-docker']).toBeDefined();
  });

  it('should handle project name with dots correctly for docker image tag', async () => {
    // Create a project with dots in the name
    addProjectConfiguration(tree, 'my.dotted.project', {
      root: 'apps/my-dotted-project',
      sourceRoot: 'apps/my-dotted-project/my_dotted_project',
      targets: {
        build: {
          executor: '@nxlv/python:build',
        },
      },
    });

    tree.write(
      'apps/my-dotted-project/pyproject.toml',
      `[project]
name = "my.dotted.project"
version = "0.1.0"
dependencies = []

[dependency-groups]
dev = []

[tool.uv]
dev-dependencies = []
`,
    );

    await pyAgentGenerator(tree, {
      project: 'my.dotted.project',
      infra: 'agentcore',
      iac: 'cdk',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/my-dotted-project/project.json', 'utf-8'),
    );

    // Check that docker command uses correct paths
    expect(
      projectConfig.targets['agent-docker'].options.commands.join(' '),
    ).toContain('project-agent');
  });

  it('should add CDK dependencies for BedrockAgentCoreRuntime', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'cdk',
    });

    // Check root package.json dependencies
    const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(rootPackageJson.dependencies['aws-cdk-lib']).toBeDefined();
  });

  it('should generate strands agent with Terraform provider and default name', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'terraform',
    });

    // Check that agent files were added to the existing project
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/__init__.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/agent.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/main.py'),
    ).toBeTruthy();

    // Dockerfile should be included for BedrockAgentCoreRuntime
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/Dockerfile'),
    ).toBeTruthy();

    // Check that Terraform files were generated
    expect(
      tree.exists('packages/common/terraform/src/core/agent-core/runtime.tf'),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/terraform/src/app/agents/test-project-agent/test-project-agent.tf',
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

  it('should generate strands agent with Terraform provider and custom name', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'custom-terraform-agent',
      infra: 'agentcore',
      iac: 'terraform',
    });

    // Check that agent files were added with custom name
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_terraform_agent/__init__.py',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_terraform_agent/agent.py',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_terraform_agent/main.py',
      ),
    ).toBeTruthy();

    // Dockerfile should be included for BedrockAgentCoreRuntime
    expect(
      tree.exists(
        'apps/test-project/proj_test_project/custom_terraform_agent/Dockerfile',
      ),
    ).toBeTruthy();

    // Check that Terraform files were generated with custom name
    expect(
      tree.exists('packages/common/terraform/src/core/agent-core/runtime.tf'),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/terraform/src/app/agents/custom-terraform-agent/custom-terraform-agent.tf',
      ),
    ).toBeTruthy();
  });

  it('should match snapshot for Terraform generated files', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'terraform-snapshot-agent',
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

    // Snapshot the generated agent Terraform file
    const agentTerraformContent = tree.read(
      'packages/common/terraform/src/app/agents/terraform-snapshot-agent/terraform-snapshot-agent.tf',
      'utf-8',
    );
    expect(agentTerraformContent).toMatchSnapshot('terraform-agent.tf');
  });

  it('should generate correct docker image tag for Terraform provider', async () => {
    // Update root package.json to have a scope
    const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    rootPackageJson.name = '@terraform-scope/workspace';
    tree.write('package.json', JSON.stringify(rootPackageJson, null, 2));

    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'terraform-agent',
      infra: 'agentcore',
      iac: 'terraform',
    });

    // Check that the docker image tag is correctly generated in the Terraform file
    const agentTerraform = tree.read(
      'packages/common/terraform/src/app/agents/terraform-agent/terraform-agent.tf',
      'utf-8',
    );
    expect(agentTerraform).toContain('terraform-scope-terraform-agent:latest');
  });

  it('should not generate Terraform files when computeType is None', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'terraform',
    });

    // Check that agent files were added
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/__init__.py'),
    ).toBeTruthy();

    // There should be no Dockerfile since the computeType is None
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/Dockerfile'),
    ).toBeFalsy();

    // Terraform files should not be generated for None compute type
    expect(
      tree.exists('packages/common/terraform/src/core/agent-core/runtime.tf'),
    ).toBeFalsy();
    expect(
      tree.exists(
        'packages/common/terraform/src/app/agents/test-project-agent/test-project-agent.tf',
      ),
    ).toBeFalsy();
  });

  it('should handle Python bundle target configuration for Terraform provider', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'terraform',
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
      'uv export --frozen --no-dev --no-editable --project {projectRoot} --package test-project -o dist/{projectRoot}/bundle-arm/requirements.txt',
      'uv pip install -n --no-deps --no-installer-metadata --no-compile-bytecode --python-platform aarch64-manylinux_2_28 --target dist/{projectRoot}/bundle-arm -r dist/{projectRoot}/bundle-arm/requirements.txt',
    ]);

    // Check that docker target was added
    expect(projectConfig.targets['agent-docker']).toBeDefined();
    expect(projectConfig.targets['agent-docker'].dependsOn).toContain(
      'bundle-arm',
    );
  });

  it('should handle default computeType as BedrockAgentCoreRuntime with Terraform', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      // No computeType specified, should default to BedrockAgentCoreRuntime
      iac: 'terraform',
    });

    // Should include Dockerfile by default
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/Dockerfile'),
    ).toBeTruthy();

    // Should have Terraform files generated
    expect(
      tree.exists('packages/common/terraform/src/core/agent-core/runtime.tf'),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/terraform/src/app/agents/test-project-agent/test-project-agent.tf',
      ),
    ).toBeTruthy();

    // Should have docker and bundle targets
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['bundle-arm']).toBeDefined();
    expect(projectConfig.targets['agent-docker']).toBeDefined();
  });

  it('should inherit iac from config when set to Inherit', async () => {
    // Set up config with Terraform provider using utility methods
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, {
      iac: {
        provider: 'terraform',
      },
    });

    await pyAgentGenerator(tree, {
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

  it('should be idempotent when re-run with same options', async () => {
    const options = {
      project: 'test-project',
      infra: 'none' as const,
      iac: 'cdk' as const,
    };
    await pyAgentGenerator(tree, options);
    const firstProjectJson = tree.read(
      'apps/test-project/project.json',
      'utf-8',
    );

    await pyAgentGenerator(tree, options);
    const secondProjectJson = tree.read(
      'apps/test-project/project.json',
      'utf-8',
    );

    const projectConfig = JSON.parse(secondProjectJson);

    // Port metadata should not grow on re-run
    expect(projectConfig.metadata.ports).toHaveLength(1);
    // The agent component should not be duplicated
    expect(projectConfig.metadata.components).toHaveLength(1);

    expect(secondProjectJson).toEqual(firstProjectJson);
  });

  it('should add component generator metadata with default name', async () => {
    await pyAgentGenerator(tree, {
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
      PY_AGENT_GENERATOR_INFO.id,
    );
    expect(projectConfig.metadata.components[0].name).toBe('agent');
    expect(projectConfig.metadata.components[0].port).toBeDefined();
    expect(typeof projectConfig.metadata.components[0].port).toBe('number');
  });

  it('should add component generator metadata with custom name', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'custom-agent',
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
      PY_AGENT_GENERATOR_INFO.id,
    );
    expect(projectConfig.metadata.components[0].name).toBe('custom-agent');
    expect(projectConfig.metadata.components[0].port).toBeDefined();
  });

  it('should generate A2A agent with protocol option', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      protocol: 'a2a',
      infra: 'none',
      iac: 'cdk',
    });

    // Check that A2A-specific main.py was generated
    const mainContent = tree.read(
      'apps/test-project/proj_test_project/agent/main.py',
      'utf-8',
    );
    expect(mainContent).toContain('A2AServer');
    expect(mainContent).toContain('to_fastapi_app');
    expect(mainContent).toContain('AGENTCORE_RUNTIME_URL');
    expect(mainContent).toContain('http_url');

    // A2A should not generate init.py (HTTP-only)
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/init.py'),
    ).toBeFalsy();

    // Check serve command uses fastapi dev (for hot reload via to_fastapi_app)
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['agent-serve'].options.commands[0]).toContain(
      'uv run fastapi dev',
    );
  });

  it('should include protocol in component metadata for A2A', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      protocol: 'a2a',
      infra: 'none',
      iac: 'cdk',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata.components[0].protocol).toBe('a2a');
  });

  it('should include protocol in component metadata for HTTP (default)', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata.components[0].protocol).toBe('http');
  });

  it('should pass A2A protocol to CDK infrastructure', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      protocol: 'a2a',
      infra: 'agentcore',
      iac: 'cdk',
    });

    const agentConstruct = tree.read(
      'packages/common/constructs/src/app/agents/test-project-agent/test-project-agent.ts',
      'utf-8',
    );
    expect(agentConstruct).toContain('ProtocolType.A2A');
    expect(agentConstruct).toContain('bedrock-agentcore:GetAgentCard');
  });

  it('should not grant GetAgentCard for HTTP protocol', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'cdk',
    });

    const agentConstruct = tree.read(
      'packages/common/constructs/src/app/agents/test-project-agent/test-project-agent.ts',
      'utf-8',
    );
    expect(agentConstruct).not.toContain('bedrock-agentcore:GetAgentCard');
  });

  it('should use default name when empty string is provided', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: '',
      infra: 'none',
      iac: 'cdk',
    });

    // Check that agent files were added with default name
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/__init__.py'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/init.py'),
    ).toBeTruthy();

    // Check that the init.py file contains the default name (title)
    const initContent = tree.read(
      'apps/test-project/proj_test_project/agent/init.py',
      'utf-8',
    );
    expect(initContent).toContain('title="TestProjectAgent"');

    // Check that project configuration was updated with default serve target
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['agent-serve']).toBeDefined();
  });

  it('should generate AG-UI agent with protocol option', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      protocol: 'ag-ui',
      infra: 'none',
      iac: 'cdk',
    });

    // Check that AG-UI-specific main.py was generated
    const mainContent = tree.read(
      'apps/test-project/proj_test_project/agent/main.py',
      'utf-8',
    );
    expect(mainContent).toContain('ag_ui_strands');
    expect(mainContent).toContain('create_strands_app');
    expect(mainContent).toContain('StrandsAgent');

    // AG-UI must bind the inbound AgentCore session ID into the ContextVar
    // so downstream MCP / A2A connection clients forward it on outbound
    // calls. (AG-UI handles its own per-thread conversation isolation, so
    // we don't wrap the agent in `with_session_id` here — only the
    // downstream forwarding path matters.)
    expect(mainContent).toContain('session_id_context');
    expect(mainContent).toContain(
      'x-amzn-bedrock-agentcore-runtime-session-id',
    );

    // AG-UI should not generate init.py (HTTP-only)
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/init.py'),
    ).toBeFalsy();

    // Check serve command uses fastapi dev on port 8081+ (not 9000)
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    const serveCmd = projectConfig.targets['agent-serve'].options.commands[0];
    expect(serveCmd).toContain('uv run fastapi dev');
    expect(serveCmd).toMatch(/--port 808\d/);
  });

  it('should include protocol in component metadata for AG-UI', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      protocol: 'ag-ui',
      infra: 'none',
      iac: 'cdk',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata.components[0].protocol).toBe('ag-ui');
  });

  it('should pass HTTP protocol to CDK infrastructure for AG-UI agents', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      protocol: 'ag-ui',
      infra: 'agentcore',
      iac: 'cdk',
    });

    // AG-UI uses HTTP as the AgentCore protocol type (AG-UI is HTTP-based with SSE)
    const agentConstruct = tree.read(
      'packages/common/constructs/src/app/agents/test-project-agent/test-project-agent.ts',
      'utf-8',
    );
    expect(agentConstruct).toContain('ProtocolType.HTTP');
    expect(agentConstruct).not.toContain('bedrock-agentcore:GetAgentCard');
  });

  it('should add ag-ui dependencies for AG-UI protocol', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      protocol: 'ag-ui',
      infra: 'none',
      iac: 'cdk',
    });

    const pyProjectToml = tree.read(
      'apps/test-project/pyproject.toml',
      'utf-8',
    );
    expect(pyProjectToml).toContain('ag-ui-protocol');
    expect(pyProjectToml).toContain('ag-ui-strands');
    expect(pyProjectToml).toContain('strands-agents');
  });

  it('should generate HTTP chat CLI with OpenAPI client gen and wire up the chat target', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
    });

    // The HTTP chat CLI script uses the generated type-safe client
    const chatScriptPath = 'apps/test-project/scripts/agent/chat.ts';
    expect(tree.exists(chatScriptPath)).toBeTruthy();
    const chatScript = tree.read(chatScriptPath, 'utf-8');
    expect(chatScript).toContain("from 'agent-chat-cli'");
    expect(chatScript).toContain('chatLoop');
    expect(chatScript).toContain('./generated/client.gen');

    // The OpenAPI spec generator script is emitted into the agent project
    expect(
      tree.exists('apps/test-project/scripts/agent_openapi.py'),
    ).toBeTruthy();

    // Chat target chains: generate-client -> openapi, and also waits for serve-local
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['agent-openapi']).toBeDefined();
    expect(
      projectConfig.targets['agent-openapi'].options.commands[0],
    ).toContain('scripts/agent_openapi.py');

    expect(projectConfig.targets['agent-generate-client']).toBeDefined();
    expect(
      projectConfig.targets['agent-generate-client'].options.commands[0],
    ).toContain('@aws/nx-plugin:open-api#ts-client');
    expect(projectConfig.targets['agent-generate-client'].dependsOn).toEqual([
      'agent-openapi',
    ]);

    const chatTarget = projectConfig.targets['agent-chat'];
    expect(chatTarget).toBeDefined();
    expect(chatTarget.options.commands[0]).toBe('tsx ./scripts/agent/chat.ts');
    // HTTP chat builds the generated client first, but runs standalone — no
    // serve-local dependency.
    expect(chatTarget.dependsOn).toEqual(['agent-generate-client']);

    // Generated client dir should be gitignored
    const gitignore = tree.read('apps/test-project/.gitignore', 'utf-8');
    expect(gitignore).toContain('scripts/agent/generated/');

    const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(rootPackageJson.devDependencies['tsx']).toBeDefined();
    expect(rootPackageJson.devDependencies['agent-chat-cli']).toBeDefined();
  });

  it('should vend a standalone chat script for A2A', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      protocol: 'a2a',
      infra: 'none',
      iac: 'cdk',
    });

    const chatScriptPath = 'apps/test-project/scripts/agent/chat.ts';
    expect(tree.exists(chatScriptPath)).toBeTruthy();
    const chatScript = tree.read(chatScriptPath, 'utf-8');
    expect(chatScript).toContain('A2AChatAdapter');
    expect(chatScript).toContain('resolveRemoteAgent');
    // No openapi/generate-client targets for A2A
    expect(
      tree.exists('apps/test-project/scripts/agent_openapi.py'),
    ).toBeFalsy();

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['agent-openapi']).toBeUndefined();
    expect(projectConfig.targets['agent-generate-client']).toBeUndefined();

    const chatTarget = projectConfig.targets['agent-chat'];
    expect(chatTarget).toBeDefined();
    expect(chatTarget.options.commands[0]).toBe('tsx ./scripts/agent/chat.ts');
    expect(chatTarget.options.env.URL).toMatch(/^http:\/\/localhost:\d+$/);
    expect(chatTarget.dependsOn).toBeUndefined();
  });

  it('should vend a standalone chat script for AG-UI', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      protocol: 'ag-ui',
      infra: 'none',
      iac: 'cdk',
    });

    const chatScriptPath = 'apps/test-project/scripts/agent/chat.ts';
    expect(tree.exists(chatScriptPath)).toBeTruthy();
    const chatScript = tree.read(chatScriptPath, 'utf-8');
    expect(chatScript).toContain('AGUIChatAdapter');
    expect(chatScript).toContain('resolveRemoteAgent');

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    const chatTarget = projectConfig.targets['agent-chat'];
    expect(chatTarget).toBeDefined();
    expect(chatTarget.options.commands[0]).toBe('tsx ./scripts/agent/chat.ts');
    expect(chatTarget.options.env.URL).toMatch(
      /^http:\/\/localhost:\d+\/invocations$/,
    );
    expect(chatTarget.dependsOn).toBeUndefined();
  });

  it('should generate HTTP chat targets with custom agent name', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'my-custom-agent',
      infra: 'none',
      iac: 'cdk',
    });

    expect(
      tree.exists('apps/test-project/scripts/my-custom-agent/chat.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/scripts/my_custom_agent_openapi.py'),
    ).toBeTruthy();

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['my-custom-agent-chat']).toBeDefined();
    expect(projectConfig.targets['my-custom-agent-chat'].dependsOn).toEqual([
      'my-custom-agent-generate-client',
    ]);
  });

  it('should generate with infra=none then upgrade to infra=agentcore', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'upgrade-agent',
      infra: 'none',
      iac: 'cdk',
    });

    expect(
      tree.exists(
        'apps/test-project/proj_test_project/upgrade_agent/__init__.py',
      ),
    ).toBeTruthy();
    expect(tree.exists('packages/common/constructs')).toBeFalsy();

    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'upgrade-agent',
      infra: 'agentcore',
      iac: 'cdk',
    });

    expect(tree.exists('packages/common/constructs')).toBeTruthy();
  });

  describe.each([
    'http',
    'a2a',
    'ag-ui',
  ] as const)('chat scripts for %s protocol', (protocol) => {
    it.each([
      'iam',
      'cognito',
    ] as const)('should match snapshot for chat scripts with %s auth', async (auth) => {
      await pyAgentGenerator(tree, {
        project: 'test-project',
        protocol,
        auth,
        infra: 'agentcore',
        iac: 'cdk',
      });

      const chat = tree.read(
        'apps/test-project/scripts/agent/chat.ts',
        'utf-8',
      );
      const agentcore = tree.read(
        'apps/test-project/scripts/agent/agentcore.ts',
        'utf-8',
      );
      expect(chat).toMatchSnapshot(`chat.ts (${protocol}, ${auth})`);
      expect(agentcore).toMatchSnapshot(`agentcore.ts (${protocol}, ${auth})`);
    });
  });

  describe('langchain framework', () => {
    it('should record framework in component metadata', async () => {
      // The mcp/gateway connection generators dispatch on this field, so it
      // must be persisted for both the default (strands) and langchain agents.
      await pyAgentGenerator(tree, {
        project: 'test-project',
        infra: 'none',
        iac: 'cdk',
      });
      let projectConfig = JSON.parse(
        tree.read('apps/test-project/project.json', 'utf-8'),
      );
      expect(projectConfig.metadata.components[0].framework).toBe('strands');

      await pyAgentGenerator(tree, {
        project: 'test-project',
        name: 'lc-agent',
        framework: 'langchain',
        protocol: 'ag-ui',
        infra: 'none',
        iac: 'cdk',
      });
      projectConfig = JSON.parse(
        tree.read('apps/test-project/project.json', 'utf-8'),
      );
      const lc = projectConfig.metadata.components.find(
        (c: { name: string }) => c.name === 'lc-agent',
      );
      expect(lc.framework).toBe('langchain');
    });

    it('should generate langchain AG-UI agent', async () => {
      await pyAgentGenerator(tree, {
        project: 'test-project',
        framework: 'langchain',
        protocol: 'ag-ui',
        infra: 'none',
        iac: 'cdk',
      });

      // The langchain ag-ui main.py uses the LangGraph AG-UI adapter and the
      // hand-rolled FastAPI run-loop (there is no create_strands_app for LangGraph).
      const mainContent = tree.read(
        'apps/test-project/proj_test_project/agent/main.py',
        'utf-8',
      );
      expect(mainContent).toContain('ag_ui_langgraph');
      expect(mainContent).toContain('LangGraphAgent');
      expect(mainContent).not.toContain('create_strands_app');
      expect(mainContent).not.toContain('StrandsAgent');

      // The session ID is still bound for downstream forwarding.
      expect(mainContent).toContain('session_id_context');
      expect(mainContent).toContain(
        'x-amzn-bedrock-agentcore-runtime-session-id',
      );

      // The langchain agent.py builds a compiled LangGraph graph with a checkpointer.
      const agentContent = tree.read(
        'apps/test-project/proj_test_project/agent/agent.py',
        'utf-8',
      );
      expect(agentContent).toContain('create_agent');
      expect(agentContent).toContain('ChatBedrockConverse');
      expect(agentContent).toContain('InMemorySaver');
      expect(agentContent).toContain('checkpointer');
      expect(agentContent).not.toContain('from strands');

      // ChatBedrockConverse's init alias is `model`, not `model_id` — `model_id=`
      // passes at runtime but fails `ty` (which blocks build/synth/deploy).
      expect(agentContent).toContain('ChatBedrockConverse(model=MODEL_ID');
      expect(agentContent).not.toContain('model_id=MODEL_ID');
    });

    it('should add langchain dependencies for langchain AG-UI', async () => {
      await pyAgentGenerator(tree, {
        project: 'test-project',
        framework: 'langchain',
        protocol: 'ag-ui',
        infra: 'none',
        iac: 'cdk',
      });

      const pyProjectToml = parse(
        tree.read('apps/test-project/pyproject.toml', 'utf-8'),
      ) as UVPyprojectToml;
      const deps = pyProjectToml.project.dependencies;
      const hasDep = (name: string) =>
        deps.some((dep) => dep.startsWith(`${name}==`));

      expect(hasDep('langchain')).toBe(true);
      expect(hasDep('langchain-aws')).toBe(true);
      expect(hasDep('langgraph')).toBe(true);
      expect(hasDep('ag-ui-langgraph')).toBe(true);
      expect(hasDep('ag-ui-protocol')).toBe(true);

      // None of the Strands dependencies should be present.
      expect(hasDep('strands-agents')).toBe(false);
      expect(hasDep('strands-agents-tools')).toBe(false);
      expect(hasDep('ag-ui-strands')).toBe(false);
    });

    it('should generate langchain HTTP agent streaming JSONL from the graph', async () => {
      await pyAgentGenerator(tree, {
        project: 'test-project',
        name: 'lc-http',
        framework: 'langchain',
        protocol: 'http',
        infra: 'none',
        iac: 'cdk',
      });

      // The langchain HTTP server reuses the framework-agnostic init.py and
      // streams the compiled graph as JSONL StreamChunks (same wire shape as
      // Strands HTTP), with no Strands or ag-ui dependency.
      const mainContent = tree.read(
        'apps/test-project/proj_test_project/lc_http/main.py',
        'utf-8',
      );
      expect(mainContent).toContain(
        'from .init import JsonStreamingResponse, app',
      );
      expect(mainContent).toContain('_graph = get_agent()');
      expect(mainContent).toContain('stream_mode="messages"');
      expect(mainContent).toContain('StreamChunk(content=text)');
      expect(mainContent).toContain('"/invocations"');
      expect(mainContent).not.toContain('ag_ui');
      expect(mainContent).not.toContain('strands');

      // init.py (the FastAPI app the OpenAPI client is generated from) is emitted.
      expect(
        tree.exists('apps/test-project/proj_test_project/lc_http/init.py'),
      ).toBe(true);

      const pyProjectToml = parse(
        tree.read('apps/test-project/pyproject.toml', 'utf-8'),
      ) as UVPyprojectToml;
      const deps = pyProjectToml.project.dependencies;
      const hasDep = (name: string) =>
        deps.some((dep) => dep.startsWith(`${name}==`));
      expect(hasDep('langchain')).toBe(true);
      expect(hasDep('langchain-aws')).toBe(true);
      expect(hasDep('langgraph')).toBe(true);
      expect(hasDep('strands-agents')).toBe(false);
      expect(hasDep('ag-ui-langgraph')).toBe(false);
    });

    it('should generate langchain A2A agent over the a2a SDK server', async () => {
      await pyAgentGenerator(tree, {
        project: 'test-project',
        name: 'lc-a2a',
        framework: 'langchain',
        protocol: 'a2a',
        infra: 'none',
        iac: 'cdk',
      });

      // The langchain A2A server drives the graph from an a2a-sdk AgentExecutor
      // and serves it via A2AStarletteApplication wrapped in /ping — no Strands.
      const mainContent = tree.read(
        'apps/test-project/proj_test_project/lc_a2a/main.py',
        'utf-8',
      );
      expect(mainContent).toContain('from a2a.server.agent_execution import');
      expect(mainContent).toContain('A2AStarletteApplication');
      expect(mainContent).toContain('class LcA2aExecutor(AgentExecutor)');
      expect(mainContent).toContain('stream_mode="messages"');
      expect(mainContent).toContain('add_artifact');
      expect(mainContent).toContain('/ping');
      expect(mainContent).not.toContain('strands');

      const pyProjectToml = parse(
        tree.read('apps/test-project/pyproject.toml', 'utf-8'),
      ) as UVPyprojectToml;
      const deps = pyProjectToml.project.dependencies;
      const hasDep = (name: string) =>
        deps.some(
          (dep) => dep.startsWith(`${name}==`) || dep.startsWith(`${name}[`),
        );
      expect(hasDep('a2a-sdk')).toBe(true);
      expect(hasDep('langchain')).toBe(true);
      expect(hasDep('strands-agents')).toBe(false);
    });

    it('should match snapshot for langchain generated files', async () => {
      await pyAgentGenerator(tree, {
        project: 'test-project',
        name: 'snapshot-agent',
        framework: 'langchain',
        protocol: 'ag-ui',
        infra: 'none',
        iac: 'cdk',
      });

      const initContent = tree.read(
        'apps/test-project/proj_test_project/snapshot_agent/__init__.py',
        'utf-8',
      );
      const agentContent = tree.read(
        'apps/test-project/proj_test_project/snapshot_agent/agent.py',
        'utf-8',
      );
      const mainContent = tree.read(
        'apps/test-project/proj_test_project/snapshot_agent/main.py',
        'utf-8',
      );

      expect(initContent).toMatchSnapshot('langchain-__init__.py');
      expect(agentContent).toMatchSnapshot('langchain-agent.py');
      expect(mainContent).toMatchSnapshot('langchain-main.py');

      const pyprojectToml = tree.read(
        'apps/test-project/pyproject.toml',
        'utf-8',
      );
      expect(pyprojectToml).toMatchSnapshot('langchain-pyproject.toml');
    });
  });
});
