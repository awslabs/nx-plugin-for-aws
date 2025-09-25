/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, readJson, readProjectConfiguration } from '@nx/devkit';
import { INFRA_APP_GENERATOR_INFO, tsInfraGenerator } from './generator';
import { TsInfraGeneratorSchema } from './schema';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';

describe('infra generator', () => {
  let tree: Tree;

  const options: TsInfraGeneratorSchema = {
    name: 'test',
    directory: 'packages',
    skipInstall: true,
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should generate files with correct content', async () => {
    await tsInfraGenerator(tree, options);
    const config = readProjectConfiguration(tree, '@proj/test');
    expect(config.projectType).toEqual('application');
    // Verify files are generated
    expect(tree.exists('packages/test/cdk.json')).toBeTruthy();
    expect(tree.exists('packages/test/src/main.ts')).toBeTruthy();
    expect(
      tree.exists('packages/test/src/stacks/application-stack.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/test/src/stages/application-stage.ts'),
    ).toBeTruthy();
    // Create snapshots of generated files
    expect(tree.read('packages/test/cdk.json').toString()).toMatchSnapshot(
      'cdk-json',
    );
    expect(tree.read('packages/test/src/main.ts').toString()).toMatchSnapshot(
      'main-ts',
    );
    expect(
      tree.read('packages/test/src/stacks/application-stack.ts').toString(),
    ).toMatchSnapshot('application-stack-ts');
    expect(
      tree.read('packages/test/src/stages/application-stage.ts').toString(),
    ).toMatchSnapshot('application-stage-ts');
  });

  it('should configure project.json with correct targets', async () => {
    await tsInfraGenerator(tree, options);
    const config = readProjectConfiguration(tree, '@proj/test');
    // Snapshot entire project configuration
    expect(config).toMatchSnapshot('project-configuration');
    // Verify and snapshot build target configuration
    expect(config.targets.build).toMatchSnapshot('build-target');
    // Verify and snapshot deploy target configuration
    expect(config.targets.deploy).toMatchSnapshot('deploy-target');
    // Verify and snapshot destroy target configuration
    expect(config.targets.destroy).toMatchSnapshot('destroy-target');
    // Test specific configuration values
    expect(config.targets.synth).toMatchObject({
      cache: true,
      executor: 'nx:run-commands',
      outputs: ['{workspaceRoot}/dist/packages/test/cdk.out'],
      dependsOn: ['^build', 'compile'],
      options: {
        cwd: 'packages/test',
        command: 'cdk synth',
      },
    });
    expect(config.targets.deploy).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: 'packages/test',
        command: 'cdk deploy --require-approval=never',
      },
    });
    expect(config.targets['deploy-ci']).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: 'packages/test',
        command:
          'cdk deploy --require-approval=never --app ../../dist/packages/test/cdk.out',
      },
    });
    expect(config.targets.destroy).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: 'packages/test',
        command: 'cdk destroy --require-approval=never',
      },
    });
    expect(config.targets['destroy-ci']).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: 'packages/test',
        command:
          'cdk destroy --require-approval=never --app ../../dist/packages/test/cdk.out',
      },
    });
    expect(config.targets.cdk).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: 'packages/test',
        command: 'cdk',
      },
    });
    expect(config.targets.bootstrap).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: 'packages/test',
        command: 'cdk bootstrap',
      },
    });
  });

  it('should generate Checkov configuration files', async () => {
    await tsInfraGenerator(tree, options);

    // Verify .checkov.yml file is generated
    expect(tree.exists('packages/test/checkov.yml')).toBeTruthy();
    const checkovConfig = tree.read('packages/test/checkov.yml').toString();
    expect(checkovConfig).toMatchSnapshot('checkov-yml');

    // Verify checkov.ts utility file is generated in shared constructs
    expect(
      tree.exists('packages/common/constructs/src/core/checkov.ts'),
    ).toBeTruthy();
    const checkovTs = tree
      .read('packages/common/constructs/src/core/checkov.ts')
      .toString();
    expect(checkovTs).toMatchSnapshot('checkov-ts');

    // Verify checkov.js export is added to shared constructs index
    const sharedConstructsIndex = tree
      .read('packages/common/constructs/src/core/index.ts')
      .toString();
    expect(sharedConstructsIndex).toContain("export * from './checkov.js';");
  });

  it('should configure Checkov target correctly', async () => {
    await tsInfraGenerator(tree, options);
    const config = readProjectConfiguration(tree, '@proj/test');

    // Verify Checkov target configuration
    expect(config.targets.checkov).toMatchSnapshot('checkov-target');
    expect(config.targets.checkov).toMatchObject({
      cache: true,
      executor: 'nx:run-commands',
      inputs: ['{workspaceRoot}/dist/{projectRoot}/cdk.out'],
      outputs: ['{workspaceRoot}/dist/{projectRoot}/checkov'],
      dependsOn: ['synth'],
      options: {
        command: expect.stringContaining('uvx checkov'),
      },
    });

    // Verify Checkov is included in build dependencies
    expect(config.targets.build.dependsOn).toContain('checkov');
  });

  it('should add required dependencies to package.json', async () => {
    await tsInfraGenerator(tree, options);
    const packageJson = JSON.parse(tree.read('package.json').toString());
    // Snapshot entire package.json
    expect(packageJson).toMatchSnapshot('package-json');
    // Snapshot dependencies section
    expect(packageJson.dependencies).toMatchSnapshot('dependencies');
    // Snapshot devDependencies section
    expect(packageJson.devDependencies).toMatchSnapshot('dev-dependencies');
    // Test specific dependency values
    expect(packageJson.dependencies).toMatchObject({
      'aws-cdk-lib': expect.any(String),
      'aws-cdk': expect.any(String),
      esbuild: expect.any(String),
      constructs: expect.any(String),
      'source-map-support': expect.any(String),
    });
    expect(packageJson.devDependencies).toMatchObject({
      tsx: expect.any(String),
    });
  });

  it('should handle custom project names correctly', async () => {
    const customOptions: TsInfraGeneratorSchema = {
      name: 'custom-infra',
      directory: 'packages',
      skipInstall: true,
    };
    await tsInfraGenerator(tree, customOptions);
    // Snapshot project configuration with custom name
    const config = readProjectConfiguration(tree, '@proj/custom-infra');
    expect(config).toMatchSnapshot('custom-name-project-config');
    // Verify file paths with custom name
    expect(tree.exists('packages/custom-infra/cdk.json')).toBeTruthy();
    expect(tree.exists('packages/custom-infra/src/main.ts')).toBeTruthy();
    expect(
      tree.exists('packages/custom-infra/src/stacks/application-stack.ts'),
    ).toBeTruthy();
    expect(
      tree.exists('packages/custom-infra/src/stages/application-stage.ts'),
    ).toBeTruthy();
    // Snapshot files with custom name
    const customFiles = {
      'cdk.json': tree.read('packages/custom-infra/cdk.json').toString(),
      'src/main.ts': tree.read('packages/custom-infra/src/main.ts').toString(),
      'src/stacks/application-stack.ts': tree
        .read('packages/custom-infra/src/stacks/application-stack.ts')
        .toString(),
      'src/stages/application-stage.ts': tree
        .read('packages/custom-infra/src/stages/application-stage.ts')
        .toString(),
    };
    expect(customFiles).toMatchSnapshot('custom-name-files');
  });

  it('should generate consistent file content across runs', async () => {
    // First run
    await tsInfraGenerator(tree, options);
    const firstRunFiles = {
      'cdk.json': tree.read('packages/test/cdk.json').toString(),
      'src/main.ts': tree.read('packages/test/src/main.ts').toString(),
      'src/stacks/application-stack.ts': tree
        .read('packages/test/src/stacks/application-stack.ts')
        .toString(),
      'src/stages/application-stage.ts': tree
        .read('packages/test/src/stages/application-stage.ts')
        .toString(),
    };
    // Reset tree and run again
    tree = createTreeUsingTsSolutionSetup();
    await tsInfraGenerator(tree, options);
    const secondRunFiles = {
      'cdk.json': tree.read('packages/test/cdk.json').toString(),
      'src/main.ts': tree.read('packages/test/src/main.ts').toString(),
      'src/stacks/application-stack.ts': tree
        .read('packages/test/src/stacks/application-stack.ts')
        .toString(),
      'src/stages/application-stage.ts': tree
        .read('packages/test/src/stages/application-stage.ts')
        .toString(),
    };
    // Compare runs
    expect(firstRunFiles).toEqual(secondRunFiles);
    expect(secondRunFiles).toMatchSnapshot('consistent-files');
  });

  it('should add generator to project metadata', async () => {
    // Call the generator function
    await tsInfraGenerator(tree, options);

    expect(
      readJson(tree, 'packages/test/project.json').metadata,
    ).toHaveProperty('generator', INFRA_APP_GENERATOR_INFO.id);
  });

  it('should add generator metric to app.ts', async () => {
    // Call the generator function
    await tsInfraGenerator(tree, options);

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, INFRA_APP_GENERATOR_INFO.metric);
  });
});
