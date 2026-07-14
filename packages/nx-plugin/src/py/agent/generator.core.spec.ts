/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { parse } from '@iarna/toml';
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import type { UVPyprojectToml } from '../../utils/nxlv-python';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { pyAgentGenerator } from './generator';

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
      'rimraf dist/apps/test-project/trivy/proj-test-project-agent-latest',
      'make-dir dist/apps/test-project/trivy/proj-test-project-agent-latest',
      'ncp apps/test-project/.trivyignore dist/apps/test-project/trivy/proj-test-project-agent-latest/.trivyignore',
      'docker save -o dist/apps/test-project/trivy/proj-test-project-agent-latest/image-0.tar proj-test-project-agent:latest',
      'docker run --rm -v "./dist/apps/test-project/trivy/proj-test-project-agent-latest":/scan public.ecr.aws/aquasecurity/trivy:0.72.0 image --input /scan/image-0.tar --ignorefile /scan/.trivyignore --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --no-progress -q',
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
});
