/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, type Tree, writeJson } from '@nx/devkit';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { sharedConstructsGenerator } from '../../utils/shared-constructs';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { CONTAINER_VERSIONS } from '../../utils/versions';
import { TS_AGENT_GENERATOR_INFO, tsAgentGenerator } from './generator';

describe('ts#agent generator', () => {
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

    // An initialised workspace has the plugin config file
    tree.write('aws-nx-plugin.config.mts', 'export default {};\n');
  });

  it('should add strands agent to existing TypeScript project with default name', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
    });

    // Check that agent files were added to the existing project
    expect(tree.exists('apps/test-project/src/agent/index.ts')).toBeTruthy();

    // The agent server imports the framework base helpers, so they must be
    // emitted + re-exported even without any connection client.
    expect(
      tree.exists(
        'packages/common/agent-connection/src/core/with-session-id-strands.ts',
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        'packages/common/agent-connection/src/core/model-errors-strands.ts',
      ),
    ).toBeTruthy();
    const agentConnectionIndex = tree.read(
      'packages/common/agent-connection/src/index.ts',
      'utf-8',
    )!;
    expect(agentConnectionIndex).toContain('with-session-id-strands');
    expect(agentConnectionIndex).toContain('model-errors-strands');

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

    // <agent>-dev is the runner; the first component also adds a project-level
    // dev aggregating it.
    expect(projectConfig.targets['agent-dev'].executor).toBe('nx:run-commands');
    expect(projectConfig.targets['agent-dev'].continuous).toBe(true);
    expect(projectConfig.targets['agent-dev'].options.env).toEqual({
      PORT: expect.any(String),
      LOCAL_DEV: 'true',
    });
    expect(projectConfig.targets['dev']).toEqual({
      continuous: true,
      dependsOn: ['agent-dev'],
    });
  });

  it('should add strands agent with custom name', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'custom-agent',
      infra: 'none',
      iac: 'cdk',
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
    await tsAgentGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
    });

    // Runtime dependencies (and the @types/* backing type imports) land in the
    // project's own manifest as catalog references
    const projectPackageJson = JSON.parse(
      tree.read('apps/test-project/package.json', 'utf-8'),
    );
    expect(projectPackageJson.dependencies['@trpc/server']).toBe('catalog:');
    expect(projectPackageJson.dependencies['@trpc/client']).toBe('catalog:');
    expect(projectPackageJson.dependencies['zod']).toBe('catalog:');
    expect(projectPackageJson.dependencies['@strands-agents/sdk']).toBe(
      'catalog:',
    );
    expect(projectPackageJson.dependencies['ws']).toBe('catalog:');
    expect(projectPackageJson.dependencies['cors']).toBe('catalog:');
    expect(
      projectPackageJson.dependencies['@aws-sdk/credential-providers'],
    ).toBe('catalog:');
    expect(projectPackageJson.dependencies['aws4fetch']).toBe('catalog:');
    expect(projectPackageJson.dependencies['@modelcontextprotocol/sdk']).toBe(
      'catalog:',
    );
    expect(projectPackageJson.devDependencies['@types/ws']).toBe('catalog:');
    expect(projectPackageJson.devDependencies['@types/cors']).toBe('catalog:');

    // Pure build/test tooling stays in the workspace root devDependencies
    const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
    expect(rootPackageJson.devDependencies['tsx']).toBeDefined();
  });

  it('should handle kebab-case conversion for names with special characters', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'My_Special#Agent!',
      infra: 'none',
      iac: 'cdk',
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
      tsAgentGenerator(tree, {
        project: 'non-ts-project',
        infra: 'none',
        iac: 'cdk',
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

    await tsAgentGenerator(tree, {
      project: '@org/nested-project',
      infra: 'none',
      iac: 'cdk',
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

    await tsAgentGenerator(tree, {
      project: 'no-source-root',
      name: 'default-src-agent',
      infra: 'none',
      iac: 'cdk',
    });

    // Should default to {projectRoot}/src
    expect(
      tree.exists('apps/no-source-root/src/default-src-agent/index.ts'),
    ).toBeTruthy();
  });

  it('should match snapshot for generated files', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'snapshot-agent',
      infra: 'none',
      iac: 'cdk',
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

    expect(indexContent).toMatchSnapshot('agent-index.ts');
    expect(initContent).toMatchSnapshot('agent-init.ts');
    expect(routerContent).toMatchSnapshot('agent-router.ts');
    expect(agentContent).toMatchSnapshot('agent-agent.ts');
    expect(clientContent).toMatchSnapshot('agent-client.ts');
    expect(agentCoreTrpcClientContent).toMatchSnapshot(
      'agent-agent-core-trpc-client.ts',
    );
    expect(agentCoreMcpClientContent).toMatchSnapshot(
      'agent-agent-core-mcp-client.ts',
    );
    expect(zAsyncIterableContent).toMatchSnapshot('agent-z-async-iterable.ts');
  });

  it('should generate strands agent with BedrockAgentCoreRuntime and default name', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'cdk',
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
    expect(projectConfig.targets['agent-docker'].options.commands).toEqual([
      'ncp apps/test-project/src/agent/Dockerfile dist/apps/test-project/bundle/agent/test-project-agent/Dockerfile',
      'docker build --platform linux/arm64 -t proj-test-project-agent:latest dist/apps/test-project/bundle/agent/test-project-agent',
    ]);
    expect(projectConfig.targets['agent-docker'].options.parallel).toBe(false);
    expect(projectConfig.targets['agent-docker'].dependsOn).toEqual(['bundle']);
    expect(projectConfig.targets['agent-docker'].outputs).toEqual([
      '{workspaceRoot}/dist/apps/test-project/bundle/agent/test-project-agent/Dockerfile',
    ]);

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
    expect(projectConfig.targets['build'].dependsOn ?? []).not.toContain(
      'trivy',
    );
  });

  it('should generate strands agent with BedrockAgentCoreRuntime and custom name', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'custom-bedrock-agent',
      infra: 'agentcore',
      iac: 'cdk',
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
    await tsAgentGenerator(tree, {
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
    await tsAgentGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'cdk',
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

    await tsAgentGenerator(tree, {
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

  it('should match snapshot for BedrockAgentCoreRuntime generated constructs files', async () => {
    await tsAgentGenerator(tree, {
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
      'apps/test-project/src/snapshot-bedrock-agent/Dockerfile',
      'utf-8',
    );
    expect(dockerfileContent).toMatchSnapshot('agent-Dockerfile');
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(tree, { iac: 'cdk' });

    await tsAgentGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
    });

    expectHasMetricTags(tree, TS_AGENT_GENERATOR_INFO.metric);
  });

  it('should generate strands agent with Terraform provider and default name', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'terraform',
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
    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'custom-terraform-agent',
      infra: 'agentcore',
      iac: 'terraform',
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
    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'terraform-snapshot-agent',
      infra: 'agentcore',
      iac: 'terraform',
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

    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'terraform-agent',
      infra: 'agentcore',
      iac: 'terraform',
    });

    // Check that the docker image tag is correctly generated in the Terraform file
    const agentTerraform = tree.read(
      'packages/common/terraform/src/app/agents/terraform-agent/terraform-agent.tf',
      'utf-8',
    );
    expect(agentTerraform).toContain('terraform-scope-terraform-agent:latest');
  });

  it('should not generate Terraform files when computeType is None', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'terraform',
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

  it('should inherit iac from config when set to Inherit', async () => {
    // Set up config with Terraform provider using utility methods
    await ensureAwsNxPluginConfig(tree);
    await updateAwsNxPluginConfig(tree, {
      iac: {
        provider: 'terraform',
      },
    });

    await tsAgentGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'inherit',
    });

    // Verify Terraform files are created (not CDK constructs)
    expect(tree.exists('packages/common/terraform')).toBeTruthy();
    expect(tree.exists('packages/common/constructs')).toBeFalsy();
    expect(
      tree.exists('packages/common/terraform/src/core/agent-core/runtime.tf'),
    ).toBeTruthy();
  });

  it('should create rolldown config file for BedrockAgentCoreRuntime', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'cdk',
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
    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'path-test-agent',
      infra: 'agentcore',
      iac: 'cdk',
    });

    // Check Dockerfile COPY path
    const dockerfile = tree.read(
      'apps/test-project/src/path-test-agent/Dockerfile',
      'utf-8',
    );
    expect(dockerfile).toContain('COPY index.js /app');

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
    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'first-agent',
      infra: 'agentcore',
      iac: 'cdk',
    });

    // Generate second agent
    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'second-agent',
      infra: 'agentcore',
      iac: 'cdk',
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

  it('should be idempotent when re-run with same options', async () => {
    const options = {
      project: 'test-project',
      infra: 'none' as const,
      iac: 'cdk' as const,
    };
    await tsAgentGenerator(tree, options);
    const firstProjectJson = tree.read(
      'apps/test-project/project.json',
      'utf-8',
    );

    await tsAgentGenerator(tree, options);
    const secondProjectJson = tree.read(
      'apps/test-project/project.json',
      'utf-8',
    );

    const projectConfig = JSON.parse(secondProjectJson);

    // Port metadata should not grow on re-run
    expect(projectConfig.metadata.ports).toHaveLength(1);
    // The agent component should not be duplicated
    expect(projectConfig.metadata.components).toHaveLength(1);

    expect(secondProjectJson).toEqual(firstProjectJson);
  });

  it('should add component generator metadata with default name', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata).toBeDefined();
    expect(projectConfig.metadata.components).toBeDefined();
    expect(projectConfig.metadata.components).toHaveLength(1);
    expect(projectConfig.metadata.components[0].generator).toBe(
      TS_AGENT_GENERATOR_INFO.id,
    );
    expect(projectConfig.metadata.components[0].name).toBe('agent');
    expect(projectConfig.metadata.components[0].port).toBeDefined();
    expect(typeof projectConfig.metadata.components[0].port).toBe('number');
  });

  it('should add component generator metadata with custom name', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'custom-agent',
      infra: 'none',
      iac: 'cdk',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata).toBeDefined();
    expect(projectConfig.metadata.components).toBeDefined();
    expect(projectConfig.metadata.components).toHaveLength(1);
    expect(projectConfig.metadata.components[0].generator).toBe(
      TS_AGENT_GENERATOR_INFO.id,
    );
    expect(projectConfig.metadata.components[0].name).toBe('custom-agent');
    expect(projectConfig.metadata.components[0].port).toBeDefined();
  });

  it('should handle default computeType as BedrockAgentCoreRuntime', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      // No computeType specified, should default to BedrockAgentCoreRuntime
      iac: 'cdk',
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
    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'first-agent',
      infra: 'none',
      iac: 'cdk',
    });

    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'second-agent',
      infra: 'none',
      iac: 'cdk',
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

  it('should generate A2A agent with protocol option', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      protocol: 'a2a',
      infra: 'none',
      iac: 'cdk',
    });

    // Check that A2A-specific index.ts was generated (overwrites the HTTP one)
    const indexContent = tree.read(
      'apps/test-project/src/agent/index.ts',
      'utf-8',
    );
    expect(indexContent).toContain('A2AExpressServer');
    expect(indexContent).not.toContain('tRPC');

    // Check dependencies include express and @a2a-js/sdk in the project manifest
    const projectPackageJson = JSON.parse(
      tree.read('apps/test-project/package.json', 'utf-8'),
    );
    expect(projectPackageJson.dependencies['express']).toBe('catalog:');
    expect(projectPackageJson.devDependencies['@types/express']).toBe(
      'catalog:',
    );
    // @a2a-js/sdk must be a direct dependency so it lands in node_modules
    // for local dev AND is bundled into the Docker image (the Strands SDK's
    // a2a/express-server module statically imports it via peer dependency).
    expect(projectPackageJson.dependencies['@a2a-js/sdk']).toBe('catalog:');

    // HTTP-specific deps should not be present
    expect(projectPackageJson.dependencies['@trpc/server']).toBeUndefined();
    expect(projectPackageJson.dependencies['ws']).toBeUndefined();
    expect(projectPackageJson.dependencies['cors']).toBeUndefined();
  });

  it('should include protocol in component metadata for A2A', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      protocol: 'a2a',
      infra: 'none',
      iac: 'cdk',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata.components[0].protocol).toBe('a2a');
  });

  it('should include protocol in component metadata for HTTP (default)', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
    });

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );

    expect(projectConfig.metadata.components[0].protocol).toBe('http');
  });

  it('should pass A2A protocol to CDK infrastructure', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      protocol: 'a2a',
      infra: 'agentcore',
      iac: 'cdk',
    });

    const agentConstruct = tree.read(
      'packages/common/constructs/src/app/agents/test-project-agent/test-project-agent.ts',
      'utf-8',
    );
    expect(agentConstruct).toContain('ProtocolType.A2A');
    expect(agentConstruct).toContain('bedrock-agentcore:GetAgentCard');
  });

  it('should not grant GetAgentCard for HTTP protocol', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      infra: 'agentcore',
      iac: 'cdk',
    });

    const agentConstruct = tree.read(
      'packages/common/constructs/src/app/agents/test-project-agent/test-project-agent.ts',
      'utf-8',
    );
    expect(agentConstruct).not.toContain('bedrock-agentcore:GetAgentCard');
  });

  it('should use default name when empty string is provided', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: '',
      infra: 'none',
      iac: 'cdk',
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

  it('should generate AG-UI agent with protocol option', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      protocol: 'ag-ui',
      infra: 'none',
      iac: 'cdk',
    });

    const indexContent = tree.read(
      'apps/test-project/src/agent/index.ts',
      'utf-8',
    );
    expect(indexContent).toContain('StrandsAgent');
    expect(indexContent).toContain('createStrandsApp');
    expect(indexContent).toContain('/invocations');
    expect(indexContent).not.toContain('tRPC');
    expect(indexContent).not.toContain('A2AExpressServer');

    const projectPackageJson = JSON.parse(
      tree.read('apps/test-project/package.json', 'utf-8'),
    );
    expect(projectPackageJson.dependencies['@ag-ui/aws-strands']).toBe(
      'catalog:',
    );
    expect(projectPackageJson.dependencies['@ag-ui/a2ui-toolkit']).toBe(
      'catalog:',
    );
    expect(projectPackageJson.dependencies['@ag-ui/client']).toBe('catalog:');
    expect(projectPackageJson.dependencies['@ag-ui/core']).toBe('catalog:');
    expect(projectPackageJson.dependencies['@ag-ui/encoder']).toBe('catalog:');
    expect(projectPackageJson.dependencies['express']).toBe('catalog:');
    expect(projectPackageJson.dependencies['cors']).toBe('catalog:');
    expect(projectPackageJson.devDependencies['@types/express']).toBe(
      'catalog:',
    );
    expect(projectPackageJson.devDependencies['@types/cors']).toBe('catalog:');

    // HTTP-only deps should not be present
    expect(projectPackageJson.dependencies['@trpc/server']).toBeUndefined();
    expect(projectPackageJson.dependencies['ws']).toBeUndefined();
  });

  it('should include protocol in component metadata for AG-UI', async () => {
    await tsAgentGenerator(tree, {
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

  it('should vend a standalone chat script for AG-UI', async () => {
    await tsAgentGenerator(tree, {
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
    // The shared remote-resolution helper is emitted alongside.
    expect(
      tree.exists('apps/test-project/scripts/agent/agentcore.ts'),
    ).toBeTruthy();

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    const chatTarget = projectConfig.targets['agent-chat'];
    expect(chatTarget).toBeDefined();
    expect(chatTarget.options.commands[0]).toBe('tsx ./scripts/agent/chat.ts');
    expect(chatTarget.options.env.URL).toMatch(
      /^http:\/\/localhost:\d+\/invocations$/,
    );
    // Chat runs standalone — no dev dependency.
    expect(chatTarget.dependsOn).toBeUndefined();
  });

  it('should pass HTTP protocol to CDK infrastructure for AG-UI', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      protocol: 'ag-ui',
      infra: 'agentcore',
      iac: 'cdk',
    });

    const agentConstruct = tree.read(
      'packages/common/constructs/src/app/agents/test-project-agent/test-project-agent.ts',
      'utf-8',
    );
    expect(agentConstruct).toContain('ProtocolType.HTTP');
    expect(agentConstruct).not.toContain('ProtocolType.A2A');
  });

  it('should generate HTTP chat CLI script and wire up the chat target', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      iac: 'cdk',
    });

    const chatScriptPath = 'apps/test-project/scripts/agent/chat.ts';
    expect(tree.exists(chatScriptPath)).toBeTruthy();

    const chatScript = tree.read(chatScriptPath, 'utf-8');
    expect(chatScript).toContain("from 'agent-chat-cli'");
    expect(chatScript).toContain('chatLoop');
    expect(chatScript).toContain('client.invoke.subscribe');
    expect(chatScript).toContain('resolveRemoteAgent');

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    const chatTarget = projectConfig.targets['agent-chat'];
    expect(chatTarget).toBeDefined();
    expect(chatTarget.options.commands[0]).toBe('tsx ./scripts/agent/chat.ts');
    expect(chatTarget.dependsOn).toBeUndefined();

    // The chat script imports agent-chat-cli, so it is declared in the
    // project's own package.json (not the workspace root) for
    // noUndeclaredDependencies to pass.
    const projectPackageJson = JSON.parse(
      tree.read('apps/test-project/package.json', 'utf-8'),
    );
    expect(projectPackageJson.devDependencies['agent-chat-cli']).toBeDefined();
  });

  it('should vend a standalone chat script for A2A', async () => {
    await tsAgentGenerator(tree, {
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

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    const chatTarget = projectConfig.targets['agent-chat'];
    expect(chatTarget).toBeDefined();
    expect(chatTarget.options.commands[0]).toBe('tsx ./scripts/agent/chat.ts');
    expect(chatTarget.options.env.URL).toMatch(/^http:\/\/localhost:\d+$/);
    expect(chatTarget.dependsOn).toBeUndefined();
  });

  it('should generate chat CLI with custom agent name', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'my-custom-agent',
      infra: 'none',
      iac: 'cdk',
    });

    expect(
      tree.exists('apps/test-project/scripts/my-custom-agent/chat.ts'),
    ).toBeTruthy();

    const projectConfig = JSON.parse(
      tree.read('apps/test-project/project.json', 'utf-8'),
    );
    expect(projectConfig.targets['my-custom-agent-chat']).toBeDefined();
    expect(
      projectConfig.targets['my-custom-agent-chat'].options.commands[0],
    ).toBe('tsx ./scripts/my-custom-agent/chat.ts');
    expect(
      projectConfig.targets['my-custom-agent-chat'].dependsOn,
    ).toBeUndefined();
  });

  describe.each(['http', 'a2a', 'ag-ui'] as const)(
    'chat scripts for %s protocol',
    (protocol) => {
      it.each(['iam', 'cognito'] as const)(
        'should match snapshot for chat scripts with %s auth',
        async (auth) => {
          await tsAgentGenerator(tree, {
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

  it('should warn when auth is explicitly set with infra=none', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await tsAgentGenerator(tree, {
      project: 'test-project',
      infra: 'none',
      auth: 'cognito',
      iac: 'cdk',
    });

    expect(warnSpy).toHaveBeenCalledWith(
      'Warning: auth is ignored when no infrastructure is configured (no infrastructure is generated)',
    );

    warnSpy.mockRestore();
  });

  it('should not warn when auth is iam with infra=none', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'no-warn-agent',
      infra: 'none',
      auth: 'iam',
      iac: 'cdk',
    });

    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('should generate with infra=none then upgrade to infra=agentcore', async () => {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'upgrade-agent',
      infra: 'none',
      iac: 'cdk',
    });

    expect(
      tree.exists('apps/test-project/src/upgrade-agent/index.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('apps/test-project/src/upgrade-agent/Dockerfile'),
    ).toBeFalsy();
    expect(tree.exists('packages/common/constructs')).toBeFalsy();

    await tsAgentGenerator(tree, {
      project: 'test-project',
      name: 'upgrade-agent',
      infra: 'agentcore',
      iac: 'cdk',
    });

    expect(
      tree.exists('apps/test-project/src/upgrade-agent/Dockerfile'),
    ).toBeTruthy();
    expect(tree.exists('packages/common/constructs')).toBeTruthy();
  });
});
