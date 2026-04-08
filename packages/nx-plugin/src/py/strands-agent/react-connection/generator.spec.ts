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
  },
);
