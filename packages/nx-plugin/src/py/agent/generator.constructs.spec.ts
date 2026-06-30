/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  addProjectConfiguration,
  joinPathFragments,
  type Tree,
} from '@nx/devkit';
import { expectHasMetricTags } from '../../utils/metrics.spec';
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
});
