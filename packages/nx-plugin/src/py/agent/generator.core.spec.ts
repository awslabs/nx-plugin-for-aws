/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { parse } from '@iarna/toml';
import { addProjectConfiguration, type Tree } from '@nx/devkit';
import type { UVPyprojectToml } from '../../utils/nxlv-python';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { CONTAINER_VERSIONS } from '../../utils/versions';
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
    expect(tree.exists(`${acBase}/core/tool_errors_strands.py`)).toBeTruthy();
    const acInit = tree.read(`${acBase}/__init__.py`, 'utf-8')!;
    expect(acInit).toContain('with_session_id');
    expect(acInit).toContain('log_model_errors');
    expect(acInit).toContain('log_tool_errors');

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

    // Check that a cacheable trivy scan target was added
    expect(projectConfig.targets['agent-trivy']).toEqual({
      cache: true,
      inputs: ['default', '^production'],
      outputs: [
        '{workspaceRoot}/dist/apps/test-project/trivy/proj-test-project-agent-latest',
      ],
      executor: 'nx:run-commands',
      options: {
        commands: [
          'rimraf dist/apps/test-project/trivy/proj-test-project-agent-latest',
          'make-dir dist/apps/test-project/trivy/proj-test-project-agent-latest',
          'ncp apps/test-project/.trivyignore dist/apps/test-project/trivy/proj-test-project-agent-latest/.trivyignore',
          'docker save -o dist/apps/test-project/trivy/proj-test-project-agent-latest/image-0.tar proj-test-project-agent:latest',
          `docker run --rm -v "./dist/apps/test-project/trivy/proj-test-project-agent-latest":/scan public.ecr.aws/aquasecurity/trivy:${CONTAINER_VERSIONS.trivy} image --input /scan/image-0.tar --ignorefile /scan/.trivyignore --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --no-progress -q`,
        ],
        parallel: false,
      },
      dependsOn: ['agent-docker'],
    });
    expect(projectConfig.targets['trivy'].dependsOn).toContain('agent-trivy');
    // Trivy is not wired into build (its result depends on the vulnerability DB).
    expect(projectConfig.targets.build.dependsOn ?? []).not.toContain('trivy');
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

  it('should warn but still generate real session content when session defaults to s3 with infra=none', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'session-warn-agent',
      infra: 'none',
      iac: 'cdk',
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("session 's3' requires infrastructure"),
    );

    // infra=none doesn't force in-memory: the generated code still honors
    // the chosen session backend, for callers who wire up matching
    // infra/runtime config themselves outside this generator.
    const sessionContent = tree.read(
      'apps/test-project/proj_test_project/session_warn_agent/session.py',
      'utf-8',
    );
    expect(sessionContent).toContain('S3SessionManager');

    warnSpy.mockRestore();
  });

  it('should not warn when session is explicitly in-memory with infra=none', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'session-none-agent',
      infra: 'none',
      session: 'in-memory',
      iac: 'cdk',
    });

    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('should support session s3 for the langchain framework', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'langchain-session-agent',
      framework: 'langchain',
      session: 's3',
      infra: 'none',
      iac: 'cdk',
    });
  });

  it('should throw when session dynamodb-s3 is requested for the strands framework', async () => {
    await expect(
      pyAgentGenerator(tree, {
        project: 'test-project',
        name: 'strands-dynamodb-agent',
        session: 'dynamodb-s3',
        infra: 'none',
        iac: 'cdk',
      }),
    ).rejects.toThrow(
      "Unsupported combination: session 'dynamodb-s3' is not implemented for the strands framework (supported: s3, in-memory).",
    );
  });

  it('should not throw when session is explicitly in-memory for the langchain framework', async () => {
    // Awaiting directly (rather than wrapping the resolved GeneratorCallback in
    // `.resolves.not.toThrow()`, which would call it) is enough: an unhandled
    // rejection here fails the test.
    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'langchain-explicit-session-agent',
      framework: 'langchain',
      session: 'in-memory',
      infra: 'none',
      iac: 'cdk',
    });
  });

  it('should not throw when session is explicitly dynamodb-s3 for the langchain framework', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'langchain-dynamodb-agent',
      framework: 'langchain',
      session: 'dynamodb-s3',
      infra: 'none',
      iac: 'cdk',
    });
  });

  it('should default to session s3 for the langchain framework', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      name: 'langchain-default-session-agent',
      framework: 'langchain',
      infra: 'none',
      iac: 'cdk',
    });

    const sessionContent = tree.read(
      'apps/test-project/proj_test_project/langchain_default_session_agent/session.py',
      'utf-8',
    );
    expect(sessionContent).toContain('S3CheckpointSaver');
  });

  it('should generate session.py using S3 storage by default for the strands framework', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
    });

    const sessionContent = tree.read(
      'apps/test-project/proj_test_project/agent/session.py',
      'utf-8',
    );
    expect(sessionContent).toMatchSnapshot('session.py (s3)');
  });

  it('should generate session.py returning None when session is in-memory', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      session: 'in-memory',
      iac: 'cdk',
    });

    const sessionContent = tree.read(
      'apps/test-project/proj_test_project/agent/session.py',
      'utf-8',
    );
    expect(sessionContent).toMatchSnapshot('session.py (in-memory)');
  });

  it('should wire session_manager directly into the Agent constructor for HTTP protocol', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
    });

    const agentContent = tree.read(
      'apps/test-project/proj_test_project/agent/agent.py',
      'utf-8',
    );
    expect(agentContent).toContain('from .session import get_session_manager');
    expect(agentContent).toContain('session_manager=get_session_manager()');
  });

  it('should wire session_manager_provider via StrandsAgentConfig for AG-UI protocol', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      protocol: 'ag-ui',
      infra: 'none',
      iac: 'cdk',
    });

    const mainContent = tree.read(
      'apps/test-project/proj_test_project/agent/main.py',
      'utf-8',
    );
    expect(mainContent).toContain(
      'from ag_ui_strands import StrandsAgent, StrandsAgentConfig',
    );
    expect(mainContent).toContain('from .session import get_session_manager');
    expect(mainContent).toContain('config=StrandsAgentConfig(');
    expect(mainContent).toContain(
      'session_manager_provider=lambda _input_data: get_session_manager()',
    );
    // AG-UI wires the session manager on the adapter, not the template Agent itself.
    const agentContent = tree.read(
      'apps/test-project/proj_test_project/agent/agent.py',
      'utf-8',
    );
    expect(agentContent).not.toContain('session_manager=get_session_manager()');
  });

  it('should generate session.py returning InMemorySaver for the langchain framework', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      framework: 'langchain',
      session: 'in-memory',
      infra: 'none',
      iac: 'cdk',
    });

    const checkpointerContent = tree.read(
      'apps/test-project/proj_test_project/agent/session.py',
      'utf-8',
    );
    expect(checkpointerContent).toMatchSnapshot('session.py (in-memory)');
  });

  it('should generate session.py using DynamoDBSaver when session is dynamodb-s3', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      framework: 'langchain',
      session: 'dynamodb-s3',
      infra: 'none',
      iac: 'cdk',
    });

    const checkpointerContent = tree.read(
      'apps/test-project/proj_test_project/agent/session.py',
      'utf-8',
    );
    expect(checkpointerContent).toMatchSnapshot('session.py (dynamodb-s3)');
  });

  it('should generate session.py using S3CheckpointSaver when session is s3', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      framework: 'langchain',
      session: 's3',
      infra: 'none',
      iac: 'cdk',
    });

    const checkpointerContent = tree.read(
      'apps/test-project/proj_test_project/agent/session.py',
      'utf-8',
    );
    expect(checkpointerContent).toMatchSnapshot('session.py (s3)');
    expect(checkpointerContent).toContain(
      '.core.s3_checkpoint_saver_langchain',
    );
    expect(checkpointerContent).toContain('S3CheckpointSaver');

    // Shared (not per-agent) — no agent-specific templating is needed.
    const moduleDirs = tree.children('packages/common/agent_connection');
    const moduleName = moduleDirs.find((c) => c.includes('agent_connection'))!;
    expect(
      tree.exists(
        `packages/common/agent_connection/${moduleName}/core/s3_checkpoint_saver_langchain.py`,
      ),
    ).toBeTruthy();
  });

  it('should not generate s3_checkpoint_saver_langchain.py when session is not s3', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      framework: 'langchain',
      session: 'dynamodb-s3',
      infra: 'none',
      iac: 'cdk',
    });

    const moduleDirs = tree.children('packages/common/agent_connection');
    const moduleName = moduleDirs.find((c) => c.includes('agent_connection'))!;
    expect(
      tree.exists(
        `packages/common/agent_connection/${moduleName}/core/s3_checkpoint_saver_langchain.py`,
      ),
    ).toBeFalsy();
  });

  it('should generate the Strands session.py instead of a LangChain checkpointer', async () => {
    await pyAgentGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
    });

    expect(
      tree.exists('apps/test-project/proj_test_project/agent/session.py'),
    ).toBeTruthy();
  });
});
