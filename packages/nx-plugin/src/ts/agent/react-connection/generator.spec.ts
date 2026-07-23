/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, updateJson } from '@nx/devkit';
import { expectHasMetricTags } from '../../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { tsProjectGenerator } from '../../lib/generator';
import { tsReactWebsiteGenerator } from '../../react-website/app/generator';
import { tsAgentGenerator } from '../generator';
import {
  TS_AGENT_REACT_CONNECTION_GENERATOR_INFO,
  tsAgentReactConnectionGenerator,
} from './generator';

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
    tree.write(
      'apps/frontend/package.json',
      JSON.stringify({ name: '@proj/frontend', type: 'module' }),
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
              auth: 'iam',
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
        auth: 'iam',
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
        auth: 'iam',
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
        auth: 'iam',
      },
    });
    const packageJson = JSON.parse(
      tree.read('apps/frontend/package.json', 'utf-8'),
    );
    expect(packageJson.dependencies['@trpc/client']).toBe('catalog:');
    expect(packageJson.dependencies['@trpc/tanstack-react-query']).toBe(
      'catalog:',
    );
    expect(packageJson.dependencies['@tanstack/react-query']).toBe('catalog:');
    expect(packageJson.dependencies['@tanstack/react-query-devtools']).toBe(
      'catalog:',
    );
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
        auth: 'iam',
      },
    });

    expect(
      tree.read(
        'apps/frontend/src/components/TestAgentAgentClientProvider.tsx',
        'utf-8',
      ),
    ).toMatchSnapshot('TestAgentAgentClientProvider-IAM.tsx');

    expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeTruthy();

    const packageJson = JSON.parse(
      tree.read('apps/frontend/package.json', 'utf-8'),
    );
    expect(packageJson.dependencies['oidc-client-ts']).toBe('catalog:');
    expect(packageJson.dependencies['react-oidc-context']).toBe('catalog:');
    expect(
      packageJson.dependencies['@aws-sdk/credential-provider-cognito-identity'],
    ).toBe('catalog:');
    expect(packageJson.dependencies['aws4fetch']).toBe('catalog:');
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
        auth: 'cognito',
      },
    });

    expect(
      tree.read(
        'apps/frontend/src/components/TestAgentAgentClientProvider.tsx',
        'utf-8',
      ),
    ).toMatchSnapshot('TestAgentAgentClientProvider-Cognito.tsx');

    expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeFalsy();

    const packageJson = JSON.parse(
      tree.read('apps/frontend/package.json', 'utf-8'),
    );
    expect(packageJson.dependencies['react-oidc-context']).toBe('catalog:');
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
        auth: 'custom',
      },
    });

    expect(
      tree.read(
        'apps/frontend/src/components/TestAgentAgentClientProvider.tsx',
        'utf-8',
      ),
    ).toMatchSnapshot('TestAgentAgentClientProvider-NoAuth.tsx');

    expect(tree.exists('apps/frontend/src/hooks/useSigV4.tsx')).toBeFalsy();

    const packageJson = JSON.parse(
      tree.read('apps/frontend/package.json', 'utf-8'),
    );
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

    const packageJson = JSON.parse(
      tree.read('apps/frontend/package.json', 'utf-8'),
    );
    expect(packageJson.dependencies['aws4fetch']).toBe('catalog:');
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree, { iac: 'cdk' });

    await tsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#agent',
        name: 'agent',
        path: 'src/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'iam',
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
          auth: 'iam',
          protocol: 'a2a',
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
        auth: 'iam',
        protocol: 'ag-ui',
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
    const packageJson = JSON.parse(
      tree.read('apps/frontend/package.json', 'utf-8'),
    );
    expect(packageJson.dependencies['@copilotkit/react-core']).toBe('catalog:');
    expect(packageJson.dependencies['@ag-ui/client']).toBe('catalog:');

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
      preferInstallDependencies: false,
      iac: 'cdk',
    });
  });

  it('should configure dev integration with generated projects', async () => {
    // Generate a ts project for the agent
    await tsProjectGenerator(tree, {
      name: 'agent-project',
      type: 'application',
    });

    // Generate a strands agent
    await tsAgentGenerator(tree, {
      project: 'agent-project',
      infra: 'none',
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

    // Verify that dev target now depends on agent dev target
    expect(frontendProject.targets['dev'].dependsOn).toContainEqual({
      projects: ['@proj/agent-project'],
      target: 'agent-dev',
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

  it('should use AG-UI local URL in dev for AG-UI agents', async () => {
    // Generate a ts project for the agent
    await tsProjectGenerator(tree, {
      name: 'agent-project',
      type: 'application',
    });

    // Generate an AG-UI agent
    await tsAgentGenerator(tree, {
      project: 'agent-project',
      protocol: 'ag-ui',
      infra: 'none',
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
        protocol: 'ag-ui',
      },
    });

    const runtimeConfigContent = tree.read(
      'frontend/src/components/RuntimeConfig/index.tsx',
      'utf-8',
    );

    // AG-UI dev should use http://localhost:PORT/invocations
    expect(runtimeConfigContent).toContain('http://localhost:8081/invocations');
    expect(runtimeConfigContent).not.toContain('ws://localhost:8081/ws');
  });

  it('should be idempotent when re-run with same options', async () => {
    await tsProjectGenerator(tree, {
      name: 'agent-project',
      type: 'application',
    });

    await tsAgentGenerator(tree, {
      project: 'agent-project',
      infra: 'none',
    });

    const options = {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#agent',
        name: 'agent',
        path: 'src/agent',
        port: 8081,
        rc: 'AgentProject',
      },
    };

    await tsAgentReactConnectionGenerator(tree, options);
    await tsAgentReactConnectionGenerator(tree, options);

    const runtimeConfigContent =
      tree.read('frontend/src/components/RuntimeConfig/index.tsx', 'utf-8') ??
      '';

    // The runtime config override should appear exactly once after re-run
    const occurrences =
      runtimeConfigContent.split('runtimeConfig.agentRuntimes.AgentProject')
        .length - 1;
    expect(occurrences).toBe(1);
  });
});
