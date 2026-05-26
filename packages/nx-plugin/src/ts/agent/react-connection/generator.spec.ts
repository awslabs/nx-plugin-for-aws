/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, updateJson } from '@nx/devkit';
import {
  TS_AGENT_REACT_CONNECTION_GENERATOR_INFO,
  tsAgentReactConnectionGenerator,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';
import { expectHasMetricTags } from '../../../utils/metrics.spec';
import { tsReactWebsiteGenerator } from '../../react-website/app/generator';
import { tsAgentGenerator } from '../generator';
import { tsProjectGenerator } from '../../lib/generator';

describe('ts strands agent react connection generator', () => {
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
        sourceRoot: 'apps/agent-project/src',
        metadata: {
          components: [
            {
              generator: 'ts#agent',
              name: 'agent',
              path: 'src/agent',
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

  it('should generate strands agent react connection files', async () => {
    await tsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#agent',
        name: 'agent',
        path: 'src/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
      },
    });
    // Verify generated files
    expect(
      tree.exists(
        'apps/frontend/src/components/TestAgentAgentClientProvider.tsx',
      ),
    ).toBeTruthy();

    expect(
      tree.read(
        'apps/frontend/src/components/TestAgentAgentClientProvider.tsx',
        'utf-8',
      ),
    ).toMatchSnapshot('TestAgentAgentClientProvider.tsx');

    expect(
      tree.exists('apps/frontend/src/hooks/useTestAgentAgent.tsx'),
    ).toBeTruthy();
    expect(
      tree.read('apps/frontend/src/hooks/useTestAgentAgent.tsx', 'utf-8'),
    ).toMatchSnapshot('useTestAgentAgent.tsx');
  });

  it('should modify main.tsx correctly', async () => {
    await tsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#agent',
        name: 'agent',
        path: 'src/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
      },
    });
    const mainTsxContent = tree.read('apps/frontend/src/main.tsx', 'utf-8');
    expect(mainTsxContent).toMatchSnapshot('main.tsx');
  });

  it('should add required dependencies', async () => {
    await tsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#agent',
        name: 'agent',
        path: 'src/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
      },
    });
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(packageJson.dependencies['@trpc/client']).toBeDefined();
    expect(
      packageJson.dependencies['@trpc/tanstack-react-query'],
    ).toBeDefined();
    expect(packageJson.dependencies['@tanstack/react-query']).toBeDefined();
    expect(
      packageJson.dependencies['@tanstack/react-query-devtools'],
    ).toBeDefined();
  });

  it('should handle IAM auth option', async () => {
    await tsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#agent',
        name: 'agent',
        path: 'src/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
      },
    });

    expect(
      tree.read(
        'apps/frontend/src/components/TestAgentAgentClientProvider.tsx',
        'utf-8',
      ),
    ).toMatchSnapshot('TestAgentAgentClientProvider-IAM.tsx');

    expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeTruthy();

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(packageJson.dependencies['oidc-client-ts']).toBeDefined();
    expect(packageJson.dependencies['react-oidc-context']).toBeDefined();
    expect(
      packageJson.dependencies['@aws-sdk/credential-provider-cognito-identity'],
    ).toBeDefined();
    expect(packageJson.dependencies['aws4fetch']).toBeDefined();
  });

  it('should handle Cognito auth option', async () => {
    await tsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#agent',
        name: 'agent',
        path: 'src/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'Cognito',
      },
    });

    expect(
      tree.read(
        'apps/frontend/src/components/TestAgentAgentClientProvider.tsx',
        'utf-8',
      ),
    ).toMatchSnapshot('TestAgentAgentClientProvider-Cognito.tsx');

    expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeFalsy();

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(packageJson.dependencies['react-oidc-context']).toBeDefined();
  });

  it('should handle no auth option', async () => {
    await tsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#agent',
        name: 'agent',
        path: 'src/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'None',
      },
    });

    expect(
      tree.read(
        'apps/frontend/src/components/TestAgentAgentClientProvider.tsx',
        'utf-8',
      ),
    ).toMatchSnapshot('TestAgentAgentClientProvider-NoAuth.tsx');

    expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeFalsy();

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(packageJson.dependencies['react-oidc-context']).toBeUndefined();
    expect(packageJson.dependencies['aws4fetch']).toBeUndefined();
  });

  it('should default auth to IAM when not set', async () => {
    // Update project metadata to not include auth
    tree.write(
      'apps/agent-project/project.json',
      JSON.stringify({
        name: 'agent-project',
        root: 'apps/agent-project',
        sourceRoot: 'apps/agent-project/src',
        metadata: {
          components: [
            {
              generator: 'ts#agent',
              name: 'agent',
              path: 'src/agent',
              port: 8081,
              rc: 'TestAgent',
            },
          ],
        },
      }),
    );

    await tsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#agent',
        name: 'agent',
        path: 'src/agent',
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

    await tsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#agent',
        name: 'agent',
        path: 'src/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
      },
    });

    expectHasMetricTags(tree, TS_AGENT_REACT_CONNECTION_GENERATOR_INFO.metric);
  });

  it('should throw when target agent uses the A2A protocol', async () => {
    await expect(
      tsAgentReactConnectionGenerator(tree, {
        sourceProject: 'frontend',
        targetProject: 'agent-project',
        targetComponent: {
          generator: 'ts#agent',
          name: 'agent',
          path: 'src/agent',
          port: 9000,
          rc: 'TestAgent',
          auth: 'IAM',
          protocol: 'A2A',
        },
      }),
    ).rejects.toThrow(/A2A/);
  });

  it('should generate AG-UI connection with CopilotKit when protocol is AG-UI', async () => {
    await tsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#agent',
        name: 'my-agui-agent',
        path: 'src/my-agui-agent',
        port: 8081,
        rc: 'MyAguiAgent',
        auth: 'IAM',
        protocol: 'AG-UI',
      },
    });

    // Should generate the AG-UI hook
    expect(
      tree.exists('apps/frontend/src/hooks/useAguiMyAguiAgent.tsx'),
    ).toBeTruthy();

    // Should generate the AguiProvider component
    expect(
      tree.exists('apps/frontend/src/components/AguiProvider.tsx'),
    ).toBeTruthy();

    // Should NOT generate the HTTP/tRPC client provider
    expect(
      tree.exists(
        'apps/frontend/src/components/MyAguiAgentAgentClientProvider.tsx',
      ),
    ).toBeFalsy();

    // Should add AG-UI/CopilotKit dependencies
    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(packageJson.dependencies['@copilotkit/react-core']).toBeDefined();
    expect(packageJson.dependencies['@ag-ui/client']).toBeDefined();

    // Should NOT add tRPC dependencies
    expect(packageJson.dependencies['@trpc/client']).toBeUndefined();
    expect(
      packageJson.dependencies['@trpc/tanstack-react-query'],
    ).toBeUndefined();
  });
});

describe('ts strands agent react connection with real projects', () => {
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
    // Generate a ts project for the agent
    await tsProjectGenerator(tree, {
      name: 'agent-project',
      projectType: 'application',
    });

    // Generate a strands agent
    await tsAgentGenerator(tree, {
      project: 'agent-project',
      computeType: 'None',
    });

    // Connect react to strands agent
    await tsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#agent',
        name: 'agent',
        path: 'src/agent',
        port: 8081,
        rc: 'AgentProject',
      },
    });

    // Read the frontend project configuration
    const frontendProject = JSON.parse(
      tree.read('frontend/project.json', 'utf-8'),
    );

    // Verify that serve-local target now depends on agent serve-local target
    expect(frontendProject.targets['serve-local'].dependsOn).toContainEqual({
      projects: ['@proj/agent-project'],
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

    // Verify that the runtime config includes the agent override
    expect(runtimeConfigContent).toContain(
      'runtimeConfig.agentRuntimes.AgentProject',
    );
    expect(runtimeConfigContent).toContain('ws://localhost:8081/ws');
  });

  it('should use AG-UI local URL in serve-local for AG-UI agents', async () => {
    // Generate a ts project for the agent
    await tsProjectGenerator(tree, {
      name: 'agent-project',
      projectType: 'application',
    });

    // Generate an AG-UI agent
    await tsAgentGenerator(tree, {
      project: 'agent-project',
      protocol: 'AG-UI',
      computeType: 'None',
    });

    // Connect react to AG-UI agent
    await tsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#agent',
        name: 'agent',
        path: 'src/agent',
        port: 8081,
        rc: 'AgentProject',
        protocol: 'AG-UI',
      },
    });

    const runtimeConfigContent = tree.read(
      'frontend/src/components/RuntimeConfig/index.tsx',
      'utf-8',
    );

    // AG-UI serve-local should use http://localhost:PORT/invocations
    expect(runtimeConfigContent).toContain('http://localhost:8081/invocations');
    expect(runtimeConfigContent).not.toContain('ws://localhost:8081/ws');
  });
});
