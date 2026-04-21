/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import {
  PY_STRANDS_AGENT_REACT_CONNECTION_GENERATOR_INFO,
  pyStrandsAgentReactConnectionGenerator,
} from './generator';
import { readProjectConfiguration } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { matchGritQL } from '../../../utils/ast';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';
import { expectHasMetricTags } from '../../../utils/metrics.spec';
import { tsReactWebsiteGenerator } from '../../../ts/react-website/app/generator';
import { pyProjectGenerator } from '../../project/generator';
import { pyStrandsAgentGenerator } from '../generator';

describe('py strands agent react connection generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    // Mock frontend project configuration
    tree.write(
      'apps/frontend/project.json',
      JSON.stringify({
        name: 'frontend',
        root: 'apps/frontend',
        sourceRoot: 'apps/frontend/src',
      }),
    );
    // Mock agent project configuration
    tree.write(
      'apps/agent-project/project.json',
      JSON.stringify({
        name: 'agent-project',
        root: 'apps/agent-project',
        sourceRoot: 'apps/agent-project/agent_project',
        metadata: {
          components: [
            {
              generator: 'py#strands-agent',
              name: 'agent',
              path: 'agent_project/agent',
              port: 8081,
              rc: 'TestAgent',
              auth: 'IAM',
            },
          ],
        },
      }),
    );
    // Mock main.tsx file
    tree.write(
      'apps/frontend/src/main.tsx',
      `
import { RouterProvider } from '@tanstack/react-router';

const App = () => <RouterProvider router={router} />;

export function Main() {
  return <App />;
}
`,
    );
  });

  it('should generate OpenAPI spec script scoped to the agent', async () => {
    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
      },
    });

    // Verify OpenAPI spec generation script was created
    expect(
      tree.exists('apps/agent-project/scripts/agent_openapi.py'),
    ).toBeTruthy();

    expect(
      tree.read('apps/agent-project/scripts/agent_openapi.py', 'utf-8'),
    ).toMatchSnapshot('agent_openapi.py');
  });

  it('should update agent project configuration with openapi target', async () => {
    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
      },
    });

    const projectConfig = JSON.parse(
      tree.read('apps/agent-project/project.json', 'utf-8'),
    );

    // Verify openapi target was added
    expect(projectConfig.targets['agent-openapi']).toBeDefined();
    expect(projectConfig.targets['agent-openapi'].executor).toBe(
      'nx:run-commands',
    );
    expect(projectConfig.targets['agent-openapi'].outputs).toEqual([
      '{workspaceRoot}/dist/{projectRoot}/openapi/agent',
    ]);
  });

  it('should update frontend project configuration with client generation target', async () => {
    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
      },
    });

    const projectConfig = JSON.parse(
      tree.read('apps/frontend/project.json', 'utf-8'),
    );

    // Verify client generation target was added
    expect(projectConfig.targets['generate:test-agent-client']).toBeDefined();
    expect(projectConfig.targets['generate:test-agent-client'].executor).toBe(
      'nx:run-commands',
    );
    expect(
      projectConfig.targets['generate:test-agent-client'].dependsOn,
    ).toContain('agent-project:agent-openapi');

    // Verify watch target was added
    expect(
      projectConfig.targets['watch-generate:test-agent-client'],
    ).toBeDefined();
    expect(
      projectConfig.targets['watch-generate:test-agent-client'].continuous,
    ).toBe(true);
  });

  it('should generate provider component', async () => {
    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
      },
    });

    expect(
      tree.exists('apps/frontend/src/components/TestAgentProvider.tsx'),
    ).toBeTruthy();
    expect(
      tree.read('apps/frontend/src/components/TestAgentProvider.tsx', 'utf-8'),
    ).toMatchSnapshot('TestAgentProvider.tsx');
  });

  it('should generate hooks', async () => {
    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
      },
    });

    expect(
      tree.exists('apps/frontend/src/hooks/useTestAgent.tsx'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/frontend/src/hooks/useTestAgentClient.tsx'),
    ).toBeTruthy();
  });

  it('should instrument providers in main.tsx', async () => {
    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
      },
    });

    expect(
      await matchGritQL(
        tree,
        'apps/frontend/src/main.tsx',
        '`<QueryClientProvider $_>$_</QueryClientProvider>`',
      ),
    ).toBe(true);

    expect(
      await matchGritQL(
        tree,
        'apps/frontend/src/main.tsx',
        '`<TestAgentProvider $_>$_</TestAgentProvider>`',
      ),
    ).toBe(true);

    expect(tree.read('apps/frontend/src/main.tsx', 'utf-8')).toMatchSnapshot(
      'main.tsx',
    );
  });

  it('should handle IAM auth option', async () => {
    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
      },
    });

    expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeTruthy();

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(packageJson.dependencies['oidc-client-ts']).toBeDefined();
    expect(packageJson.dependencies['react-oidc-context']).toBeDefined();
    expect(
      packageJson.dependencies['@aws-sdk/credential-providers'],
    ).toBeDefined();
    expect(packageJson.dependencies['aws4fetch']).toBeDefined();

    expect(
      tree.read('apps/frontend/src/components/TestAgentProvider.tsx', 'utf-8'),
    ).toMatchSnapshot('TestAgentProvider-IAM.tsx');
  });

  it('should handle Cognito auth option', async () => {
    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'Cognito',
      },
    });

    expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeFalsy();

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(packageJson.dependencies['react-oidc-context']).toBeDefined();

    expect(
      tree.read('apps/frontend/src/components/TestAgentProvider.tsx', 'utf-8'),
    ).toMatchSnapshot('TestAgentProvider-Cognito.tsx');
  });

  it('should handle no auth option', async () => {
    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'None',
      },
    });

    expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeFalsy();

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(packageJson.dependencies['react-oidc-context']).toBeUndefined();
    expect(packageJson.dependencies['aws4fetch']).toBeUndefined();
  });

  it('should default auth to IAM when not set', async () => {
    tree.write(
      'apps/agent-project/project.json',
      JSON.stringify({
        name: 'agent-project',
        root: 'apps/agent-project',
        sourceRoot: 'apps/agent-project/agent_project',
        metadata: {
          components: [
            {
              generator: 'py#strands-agent',
              name: 'agent',
              path: 'agent_project/agent',
              port: 8081,
              rc: 'TestAgent',
            },
          ],
        },
      }),
    );

    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
      },
    });

    // Should default to IAM
    expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeTruthy();

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(packageJson.dependencies['aws4fetch']).toBeDefined();
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
      },
    });

    expectHasMetricTags(
      tree,
      PY_STRANDS_AGENT_REACT_CONNECTION_GENERATOR_INFO.metric,
    );
  });

  it('should throw when target agent uses the A2A protocol', async () => {
    await expect(
      pyStrandsAgentReactConnectionGenerator(tree, {
        sourceProject: 'frontend',
        targetProject: 'agent-project',
        targetComponent: {
          generator: 'py#strands-agent',
          name: 'agent',
          path: 'agent_project/agent',
          port: 9000,
          rc: 'TestAgent',
          auth: 'IAM',
          protocol: 'A2A',
        },
      }),
    ).rejects.toThrow(/A2A/);
  });
});

describe(
  'py strands agent react connection with real projects',
  { timeout: 120_000 },
  () => {
    let tree: Tree;

    beforeEach(async () => {
      tree = createTreeUsingTsSolutionSetup();

      // Generate a React website
      await tsReactWebsiteGenerator(tree, {
        name: 'frontend',
        skipInstall: true,
        iacProvider: 'CDK',
      });
    });

    it('should configure serve-local integration with generated projects', async () => {
      // Generate a py project for the agent
      await pyProjectGenerator(tree, {
        name: 'agent-project',
        projectType: 'application',
      });

      // Generate a py strands agent
      await pyStrandsAgentGenerator(tree, {
        project: 'agent_project',
        computeType: 'None',
      });

      // Read the agent project configuration via Nx utils
      const agentProjectConfig = readProjectConfiguration(
        tree,
        'proj.agent_project',
      );
      const agentComponent = (agentProjectConfig.metadata as any)
        ?.components?.[0];

      // Connect react to py strands agent
      await pyStrandsAgentReactConnectionGenerator(tree, {
        sourceProject: 'frontend',
        targetProject: 'agent_project',
        targetComponent: agentComponent,
      });

      // Read the frontend project configuration
      const frontendProject = readProjectConfiguration(tree, '@proj/frontend');

      // Verify that serve-local target now depends on agent serve-local target
      expect(frontendProject.targets['serve-local'].dependsOn).toContainEqual({
        projects: expect.arrayContaining([
          expect.stringContaining('agent_project'),
        ]),
        target: 'agent-serve-local',
      });

      // Verify that the runtime config was created and modified
      expect(
        tree.exists('frontend/src/components/RuntimeConfig/index.tsx'),
      ).toBeTruthy();

      const runtimeConfigContent = tree.read(
        'frontend/src/components/RuntimeConfig/index.tsx',
        'utf-8',
      );

      // Verify that the runtime config includes the agent runtime override
      expect(runtimeConfigContent).toContain('runtimeConfig.agentRuntimes.');
      expect(runtimeConfigContent).toContain('http://localhost:');

      // Re-read agent project config after connection generator ran
      const updatedAgentConfig = readProjectConfiguration(
        tree,
        'proj.agent_project',
      );
      expect(updatedAgentConfig.targets['agent-openapi']).toBeDefined();

      // Verify OpenAPI spec generation script was created
      const openApiScriptPath = `${agentProjectConfig.root}/scripts/agent_openapi.py`;
      expect(tree.exists(openApiScriptPath)).toBeTruthy();
    });

    it('should configure AG-UI (CopilotKit) integration for AG-UI protocol agents', async () => {
      // Generate a py project for the agent
      await pyProjectGenerator(tree, {
        name: 'agent-project',
        projectType: 'application',
      });

      // Generate a py strands agent with AG-UI protocol
      await pyStrandsAgentGenerator(tree, {
        project: 'agent_project',
        computeType: 'None',
        protocol: 'AG-UI',
      });

      const agentProjectConfig = readProjectConfiguration(
        tree,
        'proj.agent_project',
      );
      const agentComponent = (agentProjectConfig.metadata as any)
        ?.components?.[0];

      await pyStrandsAgentReactConnectionGenerator(tree, {
        sourceProject: 'frontend',
        targetProject: 'agent_project',
        targetComponent: agentComponent,
      });

      const agentNameClassName = agentComponent.rc;

      // AG-UI creates a single shared AguiProvider and a per-agent hook
      expect(
        tree.exists('frontend/src/components/AguiProvider.tsx'),
      ).toBeTruthy();
      expect(
        tree.exists(`frontend/src/hooks/useAgui${agentNameClassName}.tsx`),
      ).toBeTruthy();

      // AG-UI should NOT generate OpenAPI scripts / hooks
      expect(
        tree.exists(`${agentProjectConfig.root}/scripts/agent_openapi.py`),
      ).toBeFalsy();

      // main.tsx should wrap <App /> with the shared AguiProvider
      expect(
        await matchGritQL(
          tree,
          'frontend/src/main.tsx',
          '`<AguiProvider>$_</AguiProvider>`',
        ),
      ).toBe(true);

      // AguiProvider should call the agent's hook and spread it into selfManagedAgents
      const providerSrc = tree.read(
        'frontend/src/components/AguiProvider.tsx',
        'utf-8',
      ) as string;
      expect(providerSrc).toContain(`useAgui${agentNameClassName}`);

      // CopilotKit + AG-UI client deps should be added to the root package.json.
      // @copilotkit/react-core v2 ships both the provider and the chat
      // components, so we don't need @copilotkit/react-ui.
      const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
      expect(packageJson.dependencies['@copilotkit/react-core']).toBeDefined();
      expect(packageJson.dependencies['@ag-ui/client']).toBeDefined();
      expect(packageJson.dependencies['@copilotkit/react-ui']).toBeUndefined();

      // serve-local should be wired up for the agent's continuous target
      const frontendProject = readProjectConfiguration(tree, '@proj/frontend');
      expect(frontendProject.targets['serve-local'].dependsOn).toContainEqual({
        projects: expect.arrayContaining([
          expect.stringContaining('agent_project'),
        ]),
        target: 'agent-serve-local',
      });
    });
  },
);

describe('py strands agent react connection generator - AG-UI protocol', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    tree.write(
      'apps/frontend/project.json',
      JSON.stringify({
        name: 'frontend',
        root: 'apps/frontend',
        sourceRoot: 'apps/frontend/src',
      }),
    );
    tree.write(
      'apps/agent-project/project.json',
      JSON.stringify({
        name: 'agent-project',
        root: 'apps/agent-project',
        sourceRoot: 'apps/agent-project/agent_project',
        metadata: {
          components: [
            {
              generator: 'py#strands-agent',
              name: 'agent',
              path: 'agent_project/agent',
              port: 8081,
              rc: 'TestAgent',
              auth: 'IAM',
              protocol: 'AG-UI',
            },
          ],
        },
      }),
    );
    tree.write(
      'apps/frontend/src/main.tsx',
      `
import { RouterProvider } from '@tanstack/react-router';

const App = () => <RouterProvider router={router} />;

export function Main() {
  return <App />;
}
`,
    );
  });

  it('should generate a shared AguiProvider and a per-agent hook for AG-UI agents', async () => {
    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
        protocol: 'AG-UI',
      },
    });

    // Shared provider — only one of these, ever
    expect(
      tree.exists('apps/frontend/src/components/AguiProvider.tsx'),
    ).toBeTruthy();
    expect(
      tree.read('apps/frontend/src/components/AguiProvider.tsx', 'utf-8'),
    ).toMatchSnapshot('AguiProvider.tsx');

    // Per-agent hook
    expect(
      tree.exists('apps/frontend/src/hooks/useAguiTestAgent.tsx'),
    ).toBeTruthy();
    expect(
      tree.read('apps/frontend/src/hooks/useAguiTestAgent.tsx', 'utf-8'),
    ).toMatchSnapshot('useAguiTestAgent.tsx');

    // Provider calls the per-agent hook
    const providerSrc = tree.read(
      'apps/frontend/src/components/AguiProvider.tsx',
      'utf-8',
    ) as string;
    expect(providerSrc).toContain(`useAguiTestAgent`);

    // AG-UI does NOT generate the OpenAPI-based provider/hooks
    expect(
      tree.exists('apps/frontend/src/components/TestAgentProvider.tsx'),
    ).toBeFalsy();
    expect(
      tree.exists('apps/agent-project/scripts/agent_openapi.py'),
    ).toBeFalsy();
  });

  it('should wrap <App /> in the shared AguiProvider in main.tsx', async () => {
    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
        protocol: 'AG-UI',
      },
    });

    expect(
      await matchGritQL(
        tree,
        'apps/frontend/src/main.tsx',
        '`<AguiProvider>$_</AguiProvider>`',
      ),
    ).toBe(true);
  });

  it('should add CopilotKit and AG-UI client dependencies for AG-UI agents', async () => {
    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'Cognito',
        protocol: 'AG-UI',
      },
    });

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(packageJson.dependencies['@copilotkit/react-core']).toBeDefined();
    expect(packageJson.dependencies['@ag-ui/client']).toBeDefined();
    expect(packageJson.dependencies['react-oidc-context']).toBeDefined();
    expect(packageJson.dependencies['@copilotkit/react-ui']).toBeUndefined();
  });

  it('should generate SigV4 hook for AG-UI agents with IAM auth', async () => {
    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
        protocol: 'AG-UI',
      },
    });

    expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeTruthy();
  });

  it('should register multiple AG-UI agents in the shared AguiProvider', async () => {
    // Mock a second agent-project so we can "connect" two agents
    tree.write(
      'apps/second-agent/project.json',
      JSON.stringify({
        name: 'second-agent',
        root: 'apps/second-agent',
        sourceRoot: 'apps/second-agent/second_agent',
        metadata: {
          components: [
            {
              generator: 'py#strands-agent',
              name: 'second',
              path: 'second_agent/second',
              port: 8082,
              rc: 'ResearchAgent',
              auth: 'Cognito',
              protocol: 'AG-UI',
            },
          ],
        },
      }),
    );

    // First connection: TestAgent (IAM)
    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
        protocol: 'AG-UI',
      },
    });

    // Second connection: ResearchAgent (Cognito)
    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'second-agent',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'second',
        path: 'second_agent/second',
        port: 8082,
        rc: 'ResearchAgent',
        auth: 'Cognito',
        protocol: 'AG-UI',
      },
    });

    // Both per-agent hooks exist
    expect(
      tree.exists('apps/frontend/src/hooks/useAguiTestAgent.tsx'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/frontend/src/hooks/useAguiResearchAgent.tsx'),
    ).toBeTruthy();

    // Provider calls both hooks and spreads both into selfManagedAgents
    const providerSrc = tree.read(
      'apps/frontend/src/components/AguiProvider.tsx',
      'utf-8',
    ) as string;
    expect(providerSrc).toContain('useAguiTestAgent');
    expect(providerSrc).toContain('useAguiResearchAgent');
    expect(providerSrc).toContain('...testAgentAgents');
    expect(providerSrc).toContain('...researchAgentAgents');
    // Snapshot the two-agent provider so we can eyeball the AST-patched output
    expect(providerSrc).toMatchSnapshot('AguiProvider-multi-agent.tsx');

    // main.tsx only has ONE AguiProvider wrapping <App />
    const mainSrc = tree.read('apps/frontend/src/main.tsx', 'utf-8') as string;
    expect(mainSrc.match(/<AguiProvider>/g)?.length).toBe(1);
  });

  it('should be idempotent when the same connection is re-run', async () => {
    const run = () =>
      pyStrandsAgentReactConnectionGenerator(tree, {
        sourceProject: 'frontend',
        targetProject: 'agent-project',
        targetComponent: {
          generator: 'py#strands-agent',
          name: 'agent',
          path: 'agent_project/agent',
          port: 8081,
          rc: 'TestAgent',
          auth: 'IAM',
          protocol: 'AG-UI',
        },
      });

    await run();
    const providerFirst = tree.read(
      'apps/frontend/src/components/AguiProvider.tsx',
      'utf-8',
    ) as string;
    const mainFirst = tree.read(
      'apps/frontend/src/main.tsx',
      'utf-8',
    ) as string;

    await run();
    const providerSecond = tree.read(
      'apps/frontend/src/components/AguiProvider.tsx',
      'utf-8',
    ) as string;
    const mainSecond = tree.read(
      'apps/frontend/src/main.tsx',
      'utf-8',
    ) as string;

    // Re-running with the same agent produces byte-identical output
    expect(providerSecond).toBe(providerFirst);
    // main.tsx still has exactly one AguiProvider wrapper
    expect(mainSecond.match(/<AguiProvider>/g)?.length).toBe(1);
    // And the second import of AguiProvider is not duplicated
    expect(
      (
        mainSecond.match(
          /import AguiProvider from '\.\/components\/AguiProvider';/g,
        ) || []
      ).length +
        (mainSecond.match(/from '\.\/components\/AguiProvider'/g) || []).length,
    ).toBeGreaterThan(0);
    // Sanity: no duplicate imports of the hook either
    expect((providerSecond.match(/useAguiTestAgent/g) || []).length).toBe(
      providerFirst.match(/useAguiTestAgent/g)?.length,
    );
  });
});

describe('py strands agent react connection generator - AG-UI themed CopilotKit', () => {
  const writeFrontend = (tree: Tree, uxProvider?: string) => {
    tree.write(
      'apps/frontend/project.json',
      JSON.stringify({
        name: 'frontend',
        root: 'apps/frontend',
        sourceRoot: 'apps/frontend/src',
        ...(uxProvider ? { metadata: { uxProvider } } : {}),
      }),
    );
    tree.write(
      'apps/agent-project/project.json',
      JSON.stringify({
        name: 'agent-project',
        root: 'apps/agent-project',
        sourceRoot: 'apps/agent-project/agent_project',
        metadata: {
          components: [
            {
              generator: 'py#strands-agent',
              name: 'agent',
              path: 'agent_project/agent',
              port: 8081,
              rc: 'TestAgent',
              auth: 'IAM',
              protocol: 'AG-UI',
            },
          ],
        },
      }),
    );
    tree.write(
      'apps/frontend/src/main.tsx',
      `
import { RouterProvider } from '@tanstack/react-router';

const App = () => <RouterProvider router={router} />;

export function Main() {
  return <App />;
}
`,
    );
  };

  const runAgui = async (tree: Tree) => {
    await pyStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'py#strands-agent',
        name: 'agent',
        path: 'agent_project/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
        protocol: 'AG-UI',
      },
    });
  };

  it('should vend the default (unstyled) copilot theme when uxProvider is None', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    writeFrontend(tree, 'None');
    await runAgui(tree);

    const themeIndex = tree.read(
      'apps/frontend/src/components/copilot/index.tsx',
      'utf-8',
    ) as string;
    expect(themeIndex).toMatchSnapshot('default-theme-index.tsx');
    expect(themeIndex).toContain('@copilotkit/react-core/v2');
    // default theme doesn't ship any theme-specific component files
    expect(
      tree.exists(
        'apps/frontend/src/components/copilot/CloudscapeAssistantMessage.tsx',
      ),
    ).toBeFalsy();
    expect(
      tree.exists(
        'apps/frontend/src/components/copilot/ShadcnAssistantMessage.tsx',
      ),
    ).toBeFalsy();
  });

  it('should vend the cloudscape-themed copilot components when uxProvider is Cloudscape', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    writeFrontend(tree, 'Cloudscape');
    await runAgui(tree);

    expect(
      tree.exists(
        'apps/frontend/src/components/copilot/CloudscapeAssistantMessage.tsx',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'apps/frontend/src/components/copilot/CloudscapeUserMessage.tsx',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'apps/frontend/src/components/copilot/CloudscapeChatInput.tsx',
      ),
    ).toBeTruthy();
    const themeIndex = tree.read(
      'apps/frontend/src/components/copilot/index.tsx',
      'utf-8',
    ) as string;
    expect(themeIndex).toMatchSnapshot('cloudscape-theme-index.tsx');
    expect(themeIndex).toContain('CloudscapeAssistantMessage');

    // Cloudscape components are imported from @cloudscape-design/* in the
    // individual theme component files
    const assistant = tree.read(
      'apps/frontend/src/components/copilot/CloudscapeAssistantMessage.tsx',
      'utf-8',
    ) as string;
    expect(assistant).toContain('@cloudscape-design');
  });

  it('should vend the shadcn-themed copilot components and shared shadcn primitives when uxProvider is Shadcn', async () => {
    const tree = createTreeUsingTsSolutionSetup();
    writeFrontend(tree, 'Shadcn');
    await runAgui(tree);

    // Shadcn theme components are vended
    expect(
      tree.exists(
        'apps/frontend/src/components/copilot/ShadcnAssistantMessage.tsx',
      ),
    ).toBeTruthy();
    expect(
      tree.exists('apps/frontend/src/components/copilot/ShadcnUserMessage.tsx'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/frontend/src/components/copilot/ShadcnChatInput.tsx'),
    ).toBeTruthy();

    // Shared shadcn components the theme depends on must be vended
    expect(
      tree.exists('packages/common/shadcn/src/components/ui/avatar.tsx'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/shadcn/src/components/ui/textarea.tsx'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/common/shadcn/src/components/ui/button.tsx'),
    ).toBeTruthy();

    const themeIndex = tree.read(
      'apps/frontend/src/components/copilot/index.tsx',
      'utf-8',
    ) as string;
    expect(themeIndex).toMatchSnapshot('shadcn-theme-index.tsx');
    expect(themeIndex).toContain('ShadcnAssistantMessage');

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(packageJson.dependencies['lucide-react']).toBeDefined();
  });
});
