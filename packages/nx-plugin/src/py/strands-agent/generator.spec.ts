/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, Tree, writeJson } from '@nx/devkit';
import {
  pyStrandsAgentGenerator,
  PY_STRANDS_AGENT_GENERATOR_INFO,
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

describe('py#strands-agent generator', () => {
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
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      iacProvider: 'CDK',
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
      'uv run python -m proj_test_project.agent.main',
    ]);
    expect(projectConfig.targets['agent-serve'].continuous).toBe(true);
  });

  it('should add strands agent with custom name', async () => {
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'custom-agent',
      iacProvider: 'CDK',
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
    ).toEqual(['uv run python -m proj_test_project.custom_agent.main']);
  });

  it('should handle kebab-case conversion for names with special characters', async () => {
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'My_Special#Agent!',
      iacProvider: 'CDK',
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
      pyStrandsAgentGenerator(tree, {
        project: 'non-py-project',
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
      pyStrandsAgentGenerator(tree, {
        project: 'no-source-root',
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

    await pyStrandsAgentGenerator(tree, {
      project: 'proj.nested-project',
      iacProvider: 'CDK',
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
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
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
    expect(projectConfig.targets['bundle']).toBeDefined();

    // Check that docker target was added
    expect(projectConfig.targets['test-project-agent-docker']).toBeDefined();
    expect(projectConfig.targets['test-project-agent-docker'].executor).toBe(
      'nx:run-commands',
    );
    expect(
      projectConfig.targets['test-project-agent-docker'].options.commands,
    ).toEqual([
      'docker build --platform linux/arm64 -t proj-test-project-agent:latest apps/test-project/proj_test_project/agent --build-context workspace=.',
    ]);

    // Check that docker target depends on bundle
    expect(
      projectConfig.targets['test-project-agent-docker'].dependsOn,
    ).toContain('bundle');

    // Check that build target depends on docker
    expect(projectConfig.targets.build.dependsOn).toContain('docker');
  });

  it('should generate strands agent with BedrockAgentCoreRuntime and custom name', async () => {
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'custom-bedrock-agent',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
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
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'None',
      iacProvider: 'CDK',
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
    expect(projectConfig.targets['bundle']).toBeUndefined();
    expect(projectConfig.targets['test-project-agent-docker']).toBeUndefined();
  });

  it('should generate shared constructs for BedrockAgentCoreRuntime', async () => {
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Verify shared constructs setup
    expect(
      tree.exists('packages/common/constructs/src/core/agent-core/runtime.ts'),
    ).toBeTruthy();
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
    await pyStrandsAgentGenerator(tree, {
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

    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'my-agent',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Check that the docker image tag is correctly generated in the agent construct
    const agentConstruct = tree.read(
      'packages/common/constructs/src/app/agents/my-agent/my-agent.ts',
      'utf-8',
    );
    expect(agentConstruct).toContain('docker inspect my-scope-my-agent:latest');
  });

  it('should handle Python bundle target configuration for BedrockAgentCoreRuntime', async () => {
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    // Check that bundle target was configured with Python-specific options
    expect(projectConfig.targets.bundle).toBeDefined();
    expect(projectConfig.targets.bundle.executor).toBe('nx:run-commands');

    // Check the exact commands for the bundle target
    const commands = projectConfig.targets.bundle.options.commands;
    expect(commands).toEqual([
      'uv export --frozen --no-dev --no-editable --project apps/test-project --package test-project -o dist/apps/test-project/bundle/requirements.txt',
      'uv pip install -n --no-deps --no-installer-metadata --no-compile-bytecode --python-platform aarch64-manylinux2014 --target dist/apps/test-project/bundle -r dist/apps/test-project/bundle/requirements.txt',
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

    await pyStrandsAgentGenerator(tree, {
      project: 'complex-project',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    // Check that the module name is extracted correctly from the source root
    const projectConfig = JSON.parse(
      tree.read('apps/complex-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['agent-serve'].options.commands).toEqual([
      'uv run python -m my_complex_module.agent.main',
    ]);
  });

  it('should handle docker target dependencies correctly for BedrockAgentCoreRuntime', async () => {
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    // Check that the specific docker target was created
    const dockerTargetName = 'test-project-agent-docker';
    expect(projectConfig.targets[dockerTargetName]).toBeDefined();
    expect(projectConfig.targets[dockerTargetName].dependsOn).toContain(
      'bundle',
    );

    // Check that the general docker target includes the specific docker target
    expect(projectConfig.targets.docker).toBeDefined();
    expect(projectConfig.targets.docker.dependsOn).toContain(dockerTargetName);

    // Check that build target depends on docker
    expect(projectConfig.targets.build.dependsOn).toContain('docker');
  });

  it('should match snapshot for generated files', async () => {
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'snapshot-agent',
      computeType: 'None',
      iacProvider: 'CDK',
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

    expect(initContent).toMatchSnapshot('strands-agent-__init__.py');
    expect(agentContent).toMatchSnapshot('strands-agent-agent.py');
    expect(mainContent).toMatchSnapshot('strands-agent-main.py');

    // Snapshot the updated pyproject.toml
    const pyprojectToml = tree.read(
      'apps/test-project/pyproject.toml',
      'utf-8',
    );
    expect(pyprojectToml).toMatchSnapshot('updated-pyproject.toml');
  });

  it('should match snapshot for BedrockAgentCoreRuntime generated constructs files', async () => {
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'snapshot-bedrock-agent',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Snapshot the generated agent-core runtime construct
    const runtimeContent = tree.read(
      'packages/common/constructs/src/core/agent-core/runtime.ts',
      'utf-8',
    );
    expect(runtimeContent).toMatchSnapshot('agent-core-runtime.ts');

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
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      iacProvider: 'CDK',
    });

    expectHasMetricTags(tree, PY_STRANDS_AGENT_GENERATOR_INFO.metric);
  });

  it('should handle default computeType as BedrockAgentCoreRuntime', async () => {
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      // No computeType specified, should default to BedrockAgentCoreRuntime
      iacProvider: 'CDK',
    });

    // Should include Dockerfile by default
    expect(
      tree.exists('apps/test-project/proj_test_project/agent/Dockerfile'),
    ).toBeTruthy();

    // Should have docker and bundle targets
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['bundle']).toBeDefined();
    expect(projectConfig.targets['test-project-agent-docker']).toBeDefined();
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

    await pyStrandsAgentGenerator(tree, {
      project: 'my.dotted.project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/my-dotted-project/project.json', 'utf-8'),
    );

    // Check that docker command uses correct image tag
    expect(
      projectConfig.targets['project-agent-docker'].options.commands[0],
    ).toContain('proj-project-agent:latest');
  });

  it('should generate strands agent with Terraform provider and default name', async () => {
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Terraform',
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
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'custom-terraform-agent',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Terraform',
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
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'terraform-snapshot-agent',
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

    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'terraform-agent',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Terraform',
    });

    // Check that the docker image tag is correctly generated in the Terraform file
    const agentTerraform = tree.read(
      'packages/common/terraform/src/app/agents/terraform-agent/terraform-agent.tf',
      'utf-8',
    );
    expect(agentTerraform).toContain('terraform-scope-terraform-agent:latest');
  });

  it('should not generate Terraform files when computeType is None', async () => {
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'None',
      iacProvider: 'Terraform',
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
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Terraform',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    // Check that bundle target was configured with Python-specific options
    expect(projectConfig.targets.bundle).toBeDefined();
    expect(projectConfig.targets.bundle.executor).toBe('nx:run-commands');

    // Check the exact commands for the bundle target
    const commands = projectConfig.targets.bundle.options.commands;
    expect(commands).toEqual([
      'uv export --frozen --no-dev --no-editable --project apps/test-project --package test-project -o dist/apps/test-project/bundle/requirements.txt',
      'uv pip install -n --no-deps --no-installer-metadata --no-compile-bytecode --python-platform aarch64-manylinux2014 --target dist/apps/test-project/bundle -r dist/apps/test-project/bundle/requirements.txt',
    ]);

    // Check that docker target was added
    expect(projectConfig.targets['test-project-agent-docker']).toBeDefined();
    expect(
      projectConfig.targets['test-project-agent-docker'].dependsOn,
    ).toContain('bundle');
  });

  it('should handle default computeType as BedrockAgentCoreRuntime with Terraform', async () => {
    await pyStrandsAgentGenerator(tree, {
      project: 'test-project',
      // No computeType specified, should default to BedrockAgentCoreRuntime
      iacProvider: 'Terraform',
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
    expect(projectConfig.targets['bundle']).toBeDefined();
    expect(projectConfig.targets['test-project-agent-docker']).toBeDefined();
  });

  it('should inherit iacProvider from config when set to Inherit', async () => {
    // Set up config with Terraform provider using utility methods
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, {
      iac: {
        provider: 'Terraform',
      },
    });

    await pyStrandsAgentGenerator(tree, {
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
});
