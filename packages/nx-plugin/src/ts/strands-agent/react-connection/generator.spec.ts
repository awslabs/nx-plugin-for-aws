/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, updateJson } from '@nx/devkit';
import {
  TS_STRANDS_AGENT_REACT_CONNECTION_GENERATOR_INFO,
  tsStrandsAgentReactConnectionGenerator,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import { sharedConstructsGenerator } from '../../../utils/shared-constructs';
import { expectHasMetricTags } from '../../../utils/metrics.spec';
import { tsReactWebsiteGenerator } from '../../react-website/app/generator';
import { tsStrandsAgentGenerator } from '../generator';
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
              generator: 'ts#strands-agent',
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
    await tsStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#strands-agent',
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
    await tsStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#strands-agent',
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
    await tsStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#strands-agent',
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
    await tsStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#strands-agent',
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
      packageJson.dependencies['@aws-sdk/credential-providers'],
    ).toBeDefined();
    expect(packageJson.dependencies['aws4fetch']).toBeDefined();
  });

  it('should handle Cognito auth option', async () => {
    await tsStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#strands-agent',
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
    await tsStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#strands-agent',
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
              generator: 'ts#strands-agent',
              name: 'agent',
              path: 'src/agent',
              port: 8081,
              rc: 'TestAgent',
            },
          ],
        },
      }),
    );

    await tsStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#strands-agent',
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

    await tsStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#strands-agent',
        name: 'agent',
        path: 'src/agent',
        port: 8081,
        rc: 'TestAgent',
        auth: 'IAM',
      },
    });

    expectHasMetricTags(
      tree,
      TS_STRANDS_AGENT_REACT_CONNECTION_GENERATOR_INFO.metric,
    );
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
    await tsStrandsAgentGenerator(tree, {
      project: 'agent-project',
      computeType: 'None',
    });

    // Connect react to strands agent
    await tsStrandsAgentReactConnectionGenerator(tree, {
      sourceProject: 'frontend',
      targetProject: 'agent-project',
      targetComponent: {
        generator: 'ts#strands-agent',
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
});
