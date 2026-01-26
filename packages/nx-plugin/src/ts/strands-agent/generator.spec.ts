/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, Tree, writeJson } from '@nx/devkit';
import {
  tsStrandsAgentGenerator,
  TS_STRANDS_AGENT_GENERATOR_INFO,
} from './generator';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils';

describe('ts#strands-agent generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();

    // Create an existing TypeScript project
    addProjectConfiguration(tree, 'test-project', {
      root: 'apps/test-project',
      sourceRoot: 'apps/test-project/src',
      targets: {
        build: {
          executor: '@nx/js:tsc',
          options: {
            outputPath: 'dist/apps/test-project',
          },
        },
      },
    });

    // Create tsconfig.json for the project
    writeJson(tree, 'apps/test-project/tsconfig.json', {});

    // Create a basic package.json for the project
    writeJson(tree, 'apps/test-project/package.json', {
      name: 'test-project',
      version: '1.0.0',
    });
  });

  it('should add strands agent to existing TypeScript project with default name', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    // Check that agent files were added to the existing project
    expect(tree.exists('apps/test-project/src/agent/index.ts')).toBeTruthy();

    // There should be no Dockerfile since the computeType is None
    expect(tree.exists('apps/test-project/src/agent/Dockerfile')).toBeFalsy();

    // Check that project configuration was updated with serve target
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['agent-serve']).toBeDefined();
    expect(projectConfig.targets['agent-serve'].executor).toBe(
      'nx:run-commands',
    );
    expect(projectConfig.targets['agent-serve'].options.commands[0]).toContain(
      'tsx --watch ./src/agent/index.ts',
    );
    expect(projectConfig.targets['agent-serve'].continuous).toBe(true);
  });

  it('should add strands agent with custom name', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'custom-agent',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    // Check that agent files were added with custom name
    expect(
      tree.exists('apps/test-project/src/custom-agent/index.ts'),
    ).toBeTruthy();

    // Check that project configuration was updated with custom serve target
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['custom-agent-serve']).toBeDefined();
    expect(
      projectConfig.targets['custom-agent-serve'].options.commands[0],
    ).toContain('tsx --watch ./src/custom-agent/index.ts');
  });

  it('should add dependencies to package.json', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    // Check root package.json dependencies
    const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(rootPackageJson.dependencies['@trpc/server']).toBeDefined();
    expect(rootPackageJson.dependencies['@trpc/client']).toBeDefined();
    expect(rootPackageJson.dependencies['zod']).toBeDefined();
    expect(rootPackageJson.dependencies['@strands-agents/sdk']).toBeDefined();
    expect(rootPackageJson.dependencies['ws']).toBeDefined();
    expect(rootPackageJson.dependencies['cors']).toBeDefined();
    expect(
      rootPackageJson.dependencies['@aws-sdk/credential-providers'],
    ).toBeDefined();
    expect(rootPackageJson.dependencies['aws4fetch']).toBeDefined();
    expect(
      rootPackageJson.dependencies['@modelcontextprotocol/sdk'],
    ).toBeDefined();
    expect(rootPackageJson.devDependencies['tsx']).toBeDefined();
    expect(rootPackageJson.devDependencies['@types/ws']).toBeDefined();
    expect(rootPackageJson.devDependencies['@types/cors']).toBeDefined();
  });

  it('should handle kebab-case conversion for names with special characters', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'My_Special#Agent!',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    // Name should be converted to kebab-case
    expect(
      tree.exists('apps/test-project/src/my-special-agent/index.ts'),
    ).toBeTruthy();

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['my-special-agent-serve']).toBeDefined();
  });

  it('should throw error for non-TypeScript project', async () => {
    // Create project without tsconfig.json
    addProjectConfiguration(tree, 'non-ts-project', {
      root: 'apps/non-ts-project',
      sourceRoot: 'apps/non-ts-project/src',
    });

    await expect(
      tsStrandsAgentGenerator(tree, {
        project: 'non-ts-project',
        computeType: 'None',
        iacProvider: 'CDK',
      }),
    ).rejects.toThrow(
      'Unsupported project non-ts-project. Expected a TypeScript project (with a tsconfig.json)',
    );
  });

  it('should handle nested project names correctly', async () => {
    // Create a project with nested name
    addProjectConfiguration(tree, '@org/nested-project', {
      root: 'libs/nested-project',
      sourceRoot: 'libs/nested-project/src',
    });

    writeJson(tree, 'libs/nested-project/tsconfig.json', {
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
      },
    });

    await tsStrandsAgentGenerator(tree, {
      project: '@org/nested-project',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    // Should use the last part of the project name for default agent name
    expect(tree.exists('libs/nested-project/src/agent/index.ts')).toBeTruthy();
  });

  it('should handle project without sourceRoot', async () => {
    // Create project without sourceRoot
    addProjectConfiguration(tree, 'no-source-root', {
      root: 'apps/no-source-root',
      targets: {
        build: {
          executor: '@nx/js:tsc',
        },
      },
    });

    writeJson(tree, 'apps/no-source-root/tsconfig.json', {
      compilerOptions: {
        target: 'ES2020',
        module: 'commonjs',
      },
    });

    await tsStrandsAgentGenerator(tree, {
      project: 'no-source-root',
      name: 'default-src-agent',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    // Should default to {projectRoot}/src
    expect(
      tree.exists('apps/no-source-root/src/default-src-agent/index.ts'),
    ).toBeTruthy();
  });

  it('should match snapshot for generated files', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'snapshot-agent',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    // Snapshot all generated agent files
    const indexContent = tree.read(
      'apps/test-project/src/snapshot-agent/index.ts',
      'utf-8',
    );
    const initContent = tree.read(
      'apps/test-project/src/snapshot-agent/init.ts',
      'utf-8',
    );
    const routerContent = tree.read(
      'apps/test-project/src/snapshot-agent/router.ts',
      'utf-8',
    );
    const agentContent = tree.read(
      'apps/test-project/src/snapshot-agent/agent.ts',
      'utf-8',
    );
    const clientContent = tree.read(
      'apps/test-project/src/snapshot-agent/client.ts',
      'utf-8',
    );
    const agentCoreTrpcClientContent = tree.read(
      'apps/test-project/src/snapshot-agent/agent-core-trpc-client.ts',
      'utf-8',
    );
    const agentCoreMcpClientContent = tree.read(
      'apps/test-project/src/snapshot-agent/agent-core-mcp-client.ts',
      'utf-8',
    );
    const zAsyncIterableContent = tree.read(
      'apps/test-project/src/snapshot-agent/schema/z-async-iterable.ts',
      'utf-8',
    );

    expect(indexContent).toMatchSnapshot('strands-agent-index.ts');
    expect(initContent).toMatchSnapshot('strands-agent-init.ts');
    expect(routerContent).toMatchSnapshot('strands-agent-router.ts');
    expect(agentContent).toMatchSnapshot('strands-agent-agent.ts');
    expect(clientContent).toMatchSnapshot('strands-agent-client.ts');
    expect(agentCoreTrpcClientContent).toMatchSnapshot(
      'strands-agent-agent-core-trpc-client.ts',
    );
    expect(agentCoreMcpClientContent).toMatchSnapshot(
      'strands-agent-agent-core-mcp-client.ts',
    );
    expect(zAsyncIterableContent).toMatchSnapshot(
      'strands-agent-z-async-iterable.ts',
    );
  });

  it('should generate strands agent with BedrockAgentCoreRuntime and default name', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Check that agent files were added to the existing project
    expect(tree.exists('apps/test-project/src/agent/index.ts')).toBeTruthy();

    // Dockerfile should be included for BedrockAgentCoreRuntime
    expect(tree.exists('apps/test-project/src/agent/Dockerfile')).toBeTruthy();

    // Check that project configuration was updated with serve target
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['agent-serve']).toBeDefined();

    // Check that bundle target was added
    expect(projectConfig.targets['bundle']).toBeDefined();
    expect(projectConfig.targets['bundle'].executor).toBe('nx:run-commands');
    expect(projectConfig.targets['bundle'].options.command).toBe(
      'rolldown -c rolldown.config.ts',
    );
    expect(projectConfig.targets['bundle'].options.cwd).toBe('{projectRoot}');

    // Check that docker target was added
    expect(projectConfig.targets['agent-docker']).toBeDefined();
    expect(projectConfig.targets['agent-docker'].options.command).toBe(
      'docker build --platform linux/arm64 -t proj-test-project-agent:latest apps/test-project/src/agent --build-context workspace=.',
    );
    expect(projectConfig.targets['agent-docker'].dependsOn).toEqual(['bundle']);
  });

  it('should generate strands agent with BedrockAgentCoreRuntime and custom name', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'custom-bedrock-agent',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Check that agent files were added with custom name
    expect(
      tree.exists('apps/test-project/src/custom-bedrock-agent/index.ts'),
    ).toBeTruthy();

    // Dockerfile should be included for BedrockAgentCoreRuntime
    expect(
      tree.exists('apps/test-project/src/custom-bedrock-agent/Dockerfile'),
    ).toBeTruthy();

    // Check that project configuration was updated with custom serve targets
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['custom-bedrock-agent-serve']).toBeDefined();

    // Check that bundle target was added
    expect(projectConfig.targets['bundle']).toBeDefined();

    // Check that docker target was added with custom name
    expect(projectConfig.targets['custom-bedrock-agent-docker']).toBeDefined();
  });

  it('should generate shared constructs for BedrockAgentCoreRuntime', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
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
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    const sharedConstructsConfig = JSON.parse(
      tree.read('packages/common/constructs/project.json', 'utf-8'),
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

    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'my-agent',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Check that the docker image tag is correctly generated in the agent construct
    const agentConstruct = tree.read(
      'packages/common/constructs/src/app/agents/my-agent/my-agent.ts',
      'utf-8',
    );
    expect(agentConstruct).toContain('docker inspect my-scope-my-agent:latest');
  });

  it('should match snapshot for BedrockAgentCoreRuntime generated constructs files', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'snapshot-bedrock-agent',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
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
      'apps/test-project/src/snapshot-bedrock-agent/Dockerfile',
      'utf-8',
    );
    expect(dockerfileContent).toMatchSnapshot('agent-Dockerfile');
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree, { iacProvider: 'CDK' });

    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    expectHasMetricTags(tree, TS_STRANDS_AGENT_GENERATOR_INFO.metric);
  });

  it('should generate strands agent with Terraform provider and default name', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Terraform',
    });

    // Check that agent files were added to the existing project
    expect(tree.exists('apps/test-project/src/agent/index.ts')).toBeTruthy();

    // Dockerfile should be included for BedrockAgentCoreRuntime
    expect(tree.exists('apps/test-project/src/agent/Dockerfile')).toBeTruthy();

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
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'custom-terraform-agent',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Terraform',
    });

    // Check that agent files were added with custom name
    expect(
      tree.exists('apps/test-project/src/custom-terraform-agent/index.ts'),
    ).toBeTruthy();

    // Dockerfile should be included for BedrockAgentCoreRuntime
    expect(
      tree.exists('apps/test-project/src/custom-terraform-agent/Dockerfile'),
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
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'terraform-snapshot-agent',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Terraform',
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

    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'terraform-agent',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Terraform',
    });

    // Check that the docker image tag is correctly generated in the Terraform file
    const agentTerraform = tree.read(
      'packages/common/terraform/src/app/agents/terraform-agent/terraform-agent.tf',
      'utf-8',
    );
    expect(agentTerraform).toContain('terraform-scope-terraform-agent:latest');
  });

  it('should not generate Terraform files when computeType is None', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'None',
      iacProvider: 'Terraform',
    });

    // Check that agent files were added
    expect(tree.exists('apps/test-project/src/agent/index.ts')).toBeTruthy();

    // There should be no Dockerfile since the computeType is None
    expect(tree.exists('apps/test-project/src/agent/Dockerfile')).toBeFalsy();

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

  it('should inherit iacProvider from config when set to Inherit', async () => {
    // Set up config with Terraform provider using utility methods
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, {
      iac: {
        provider: 'Terraform',
      },
    });

    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'Inherit',
    });

    // Verify Terraform files are created (not CDK constructs)
    expect(tree.exists('packages/common/terraform')).toBeTruthy();
    expect(tree.exists('packages/common/constructs')).toBeFalsy();
    expect(
      tree.exists('packages/common/terraform/src/core/agent-core/runtime.tf'),
    ).toBeTruthy();
  });

  it('should create rolldown config file for BedrockAgentCoreRuntime', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Check rolldown config file was created
    expect(tree.exists('apps/test-project/rolldown.config.ts')).toBeTruthy();

    const rolldownConfig = tree.read(
      'apps/test-project/rolldown.config.ts',
      'utf-8',
    );
    expect(rolldownConfig).toContain('defineConfig');
    expect(rolldownConfig).toContain('src/agent/index.ts');
    expect(rolldownConfig).toContain(
      '../../dist/apps/test-project/bundle/agent/test-project-agent/index.js',
    );
  });

  it('should ensure Dockerfile COPY path matches bundle output path', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'path-test-agent',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Check Dockerfile COPY path
    const dockerfile = tree.read(
      'apps/test-project/src/path-test-agent/Dockerfile',
      'utf-8',
    );
    expect(dockerfile).toContain(
      'COPY --from=workspace dist/apps/test-project/bundle/agent/path-test-agent/index.js /app',
    );

    // Check rolldown config output path matches
    const rolldownConfig = tree.read(
      'apps/test-project/rolldown.config.ts',
      'utf-8',
    );
    expect(rolldownConfig).toContain(
      '../../dist/apps/test-project/bundle/agent/path-test-agent/index.js',
    );
  });

  it('should handle multiple strands agents without clashing', async () => {
    // Generate first agent
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'first-agent',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Generate second agent
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'second-agent',
      computeType: 'BedrockAgentCoreRuntime',
      iacProvider: 'CDK',
    });

    // Check both agent directories exist
    expect(
      tree.exists('apps/test-project/src/first-agent/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/second-agent/index.ts'),
    ).toBeTruthy();

    // Check rolldown config contains both agents
    const rolldownConfig = tree.read(
      'apps/test-project/rolldown.config.ts',
      'utf-8',
    );
    expect(rolldownConfig).toContain('src/first-agent/index.ts');
    expect(rolldownConfig).toContain('src/second-agent/index.ts');
    expect(rolldownConfig).toContain(
      '../../dist/apps/test-project/bundle/agent/first-agent/index.js',
    );
    expect(rolldownConfig).toContain(
      '../../dist/apps/test-project/bundle/agent/second-agent/index.js',
    );

    // Check both CDK constructs exist
    expect(
      tree.exists(
        'packages/common/constructs/src/app/agents/first-agent/first-agent.ts',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/constructs/src/app/agents/second-agent/second-agent.ts',
      ),
    ).toBeTruthy();

    // Check agents index exports both
    const agentsIndex = tree.read(
      'packages/common/constructs/src/app/agents/index.ts',
      'utf-8',
    );
    expect(agentsIndex).toContain(
      "export * from './first-agent/first-agent.js';",
    );
    expect(agentsIndex).toContain(
      "export * from './second-agent/second-agent.js';",
    );

    // Check both docker targets exist
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['first-agent-docker']).toBeDefined();
    expect(projectConfig.targets['second-agent-docker']).toBeDefined();
  });

  it('should add component generator metadata with default name', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata).toBeDefined();
    expect(projectConfig.metadata.components).toBeDefined();
    expect(projectConfig.metadata.components).toHaveLength(1);
    expect(projectConfig.metadata.components[0].generator).toBe(
      TS_STRANDS_AGENT_GENERATOR_INFO.id,
    );
    expect(projectConfig.metadata.components[0].name).toBe('agent');
    expect(projectConfig.metadata.components[0].port).toBeDefined();
    expect(typeof projectConfig.metadata.components[0].port).toBe('number');
  });

  it('should add component generator metadata with custom name', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'custom-agent',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata).toBeDefined();
    expect(projectConfig.metadata.components).toBeDefined();
    expect(projectConfig.metadata.components).toHaveLength(1);
    expect(projectConfig.metadata.components[0].generator).toBe(
      TS_STRANDS_AGENT_GENERATOR_INFO.id,
    );
    expect(projectConfig.metadata.components[0].name).toBe('custom-agent');
    expect(projectConfig.metadata.components[0].port).toBeDefined();
  });

  it('should handle default computeType as BedrockAgentCoreRuntime', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      // No computeType specified, should default to BedrockAgentCoreRuntime
      iacProvider: 'CDK',
    });

    // Should include Dockerfile by default
    expect(tree.exists('apps/test-project/src/agent/Dockerfile')).toBeTruthy();

    // Should have docker and bundle targets
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['bundle']).toBeDefined();
    expect(projectConfig.targets['agent-docker']).toBeDefined();
  });

  it('should assign unique port for local development', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'first-agent',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: 'second-agent',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    const firstAgentPort = projectConfig.metadata.components[0].port;
    const secondAgentPort = projectConfig.metadata.components[1].port;

    // Ports should be different
    expect(firstAgentPort).not.toBe(secondAgentPort);

    // Check that serve targets use the assigned ports
    expect(projectConfig.targets['first-agent-serve'].options.env.PORT).toBe(
      `${firstAgentPort}`,
    );
    expect(projectConfig.targets['second-agent-serve'].options.env.PORT).toBe(
      `${secondAgentPort}`,
    );
  });

  it('should use default name when empty string is provided', async () => {
    await tsStrandsAgentGenerator(tree, {
      project: 'test-project',
      name: '',
      computeType: 'None',
      iacProvider: 'CDK',
    });

    // Check that agent files were added with default name
    expect(tree.exists('apps/test-project/src/agent/index.ts')).toBeTruthy();
    expect(tree.exists('apps/test-project/src/agent/router.ts')).toBeTruthy();

    // Check that project configuration was updated with default serve target
    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['agent-serve']).toBeDefined();
    expect(projectConfig.targets['agent-serve'].options.commands[0]).toContain(
      'tsx --watch ./src/agent/index.ts',
    );

    // Check that metadata uses default name
    expect(projectConfig.metadata.components[0].name).toBe('agent');
  });
});
