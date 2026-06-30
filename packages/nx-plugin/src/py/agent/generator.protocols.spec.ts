/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { addProjectConfiguration, type Tree } from '@nx/devkit';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils';
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
});
