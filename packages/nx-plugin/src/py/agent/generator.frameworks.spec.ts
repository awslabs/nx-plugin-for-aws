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

    // Chat target chains: generate-client -> openapi, and also waits for dev
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
    // dev dependency.
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

  describe.each(['http', 'a2a', 'ag-ui'] as const)(
    'chat scripts for %s protocol',
    (protocol) => {
      it.each(['iam', 'cognito'] as const)(
        'should match snapshot for chat scripts with %s auth',
        async (auth) => {
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
          expect(agentcore).toMatchSnapshot(
            `agentcore.ts (${protocol}, ${auth})`,
          );
        },
      );
    },
  );

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

    it('should generate langchain HTTP agent reusing the shared FastAPI app', async () => {
      await pyAgentGenerator(tree, {
        project: 'test-project',
        framework: 'langchain',
        protocol: 'http',
        infra: 'none',
        iac: 'cdk',
      });

      // The langchain http main.py drives the compiled LangGraph graph and
      // reuses the framework-agnostic init.py (app + JsonStreamingResponse).
      const mainContent = tree.read(
        'apps/test-project/proj_test_project/agent/main.py',
        'utf-8',
      );
      expect(mainContent).toContain(
        'from .init import JsonStreamingResponse, app',
      );
      expect(mainContent).toContain('get_agent');
      expect(mainContent).toContain('astream');
      expect(mainContent).toContain('/invocations');
      // No Strands streaming shape leaked in.
      expect(mainContent).not.toContain('stream_async');
      expect(mainContent).not.toContain('with_session_id');
      expect(mainContent).not.toContain('from strands');

      // The shared framework-agnostic init.py is emitted alongside it.
      const initContent = tree.read(
        'apps/test-project/proj_test_project/agent/init.py',
        'utf-8',
      );
      expect(initContent).toContain('class JsonStreamingResponse');
      expect(initContent).toContain('app = FastAPI(');

      // The agent.py builds a compiled LangGraph graph, not a Strands agent.
      const agentContent = tree.read(
        'apps/test-project/proj_test_project/agent/agent.py',
        'utf-8',
      );
      expect(agentContent).toContain('create_agent');
      expect(agentContent).not.toContain('from strands');
    });

    it('should generate langchain A2A agent', async () => {
      await pyAgentGenerator(tree, {
        project: 'test-project',
        framework: 'langchain',
        protocol: 'a2a',
        infra: 'none',
        iac: 'cdk',
      });

      // The langchain a2a main.py exposes the LangGraph graph over the
      // framework-agnostic a2a-sdk, not the Strands A2AServer.
      const mainContent = tree.read(
        'apps/test-project/proj_test_project/agent/main.py',
        'utf-8',
      );
      expect(mainContent).toContain('get_agent');
      expect(mainContent).toContain('/ping');
      expect(mainContent).toContain('session_id_context');
      expect(mainContent).toContain(
        'x-amzn-bedrock-agentcore-runtime-session-id',
      );
      // The graph reply is published as a task artifact so streaming A2A clients
      // (e.g. the chat CLI) render it.
      expect(mainContent).toContain('add_artifact');
      expect(mainContent).toContain('get_current_session_id');
      // No Strands A2A server shape leaked in.
      expect(mainContent).not.toContain('strands.multiagent.a2a');
      expect(mainContent).not.toContain('A2AServer');
      expect(mainContent).not.toContain('from strands');
    });

    it('should add per-protocol langchain dependencies', async () => {
      // Each protocol needs a clean project (deps accumulate in a shared
      // pyproject.toml across generator runs), so build an isolated tree per
      // call and return its langchain agent's resolved dependency list.
      const depsFor = async (protocol: 'http' | 'a2a' | 'ag-ui') => {
        const t = createTreeUsingTsSolutionSetup();
        addProjectConfiguration(t, 'p', {
          root: 'apps/p',
          sourceRoot: 'apps/p/proj_p',
          targets: {},
        });
        t.write(
          'apps/p/pyproject.toml',
          `[project]\nname = "proj.p"\nversion = "0.1.0"\ndependencies = []\n\n[dependency-groups]\ndev = []\n\n[tool.uv]\ndev-dependencies = []\n`,
        );
        await pyAgentGenerator(t, {
          project: 'p',
          framework: 'langchain',
          protocol,
          infra: 'none',
          iac: 'cdk',
        });
        const pyProjectToml = parse(
          t.read('apps/p/pyproject.toml', 'utf-8'),
        ) as UVPyprojectToml;
        const deps = pyProjectToml.project.dependencies;
        return (name: string) => deps.some((d) => d.startsWith(`${name}==`));
      };

      // a2a langchain pulls a2a-sdk (and never the ag-ui adapter or Strands).
      const a2a = await depsFor('a2a');
      expect(a2a('a2a-sdk')).toBe(true);
      expect(a2a('langchain')).toBe(true);
      expect(a2a('ag-ui-langgraph')).toBe(false);
      expect(a2a('strands-agents[a2a]')).toBe(false);

      // http langchain pulls only the base langchain deps (FastAPI is common).
      const http = await depsFor('http');
      expect(http('langchain')).toBe(true);
      expect(http('a2a-sdk')).toBe(false);
      expect(http('ag-ui-langgraph')).toBe(false);
      expect(http('strands-agents')).toBe(false);
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
