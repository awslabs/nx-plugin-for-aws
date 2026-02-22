/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, readJson, readProjectConfiguration } from '@nx/devkit';
import { INFRA_APP_GENERATOR_INFO, tsInfraGenerator } from './generator';
import { TsInfraGeneratorSchema } from './schema';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test';
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
      outputs: ['{workspaceRoot}/dist/{projectRoot}/cdk.out'],
      dependsOn: ['^build', 'compile'],
      options: {
        cwd: '{projectRoot}',
        command: 'cdk synth',
      },
    });
    // Default (enableStageConfig=false): deploy uses cdk directly
    expect(config.targets.deploy).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command: 'cdk deploy --require-approval=never',
      },
      dependsOn: ['^build', 'compile'],
    });
    expect(config.targets['deploy-ci']).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command:
          'cdk deploy --require-approval=never --app ../../dist/{projectRoot}/cdk.out',
      },
    });
    // Default (enableStageConfig=false): destroy uses cdk directly
    expect(config.targets.destroy).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command: 'cdk destroy --require-approval=never',
      },
      dependsOn: ['^build', 'compile'],
    });
    expect(config.targets['destroy-ci']).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command:
          'cdk destroy --require-approval=never --app ../../dist/{projectRoot}/cdk.out',
      },
    });
    expect(config.targets.cdk).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command: 'cdk',
      },
    });
    expect(config.targets.bootstrap).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
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
        command: expect.stringContaining('uvx checkov=='),
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
    expect(JSON.stringify(config)).not.toContain('packages/infra');
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
    await tsInfraGenerator(tree, options);

    expect(
      readJson(tree, 'packages/test/project.json').metadata,
    ).toHaveProperty('generator', INFRA_APP_GENERATOR_INFO.id);
  });

  it('should add generator metric to app.ts', async () => {
    await tsInfraGenerator(tree, options);

    // Verify the metric was added to app.ts
    expectHasMetricTags(tree, INFRA_APP_GENERATOR_INFO.metric);
  });

  it('should not generate infra-config or scripts packages by default', async () => {
    await tsInfraGenerator(tree, options);
    expect(
      tree.exists('packages/common/infra-config/project.json'),
    ).toBeFalsy();
    expect(tree.exists('packages/common/scripts/project.json')).toBeFalsy();
  });

  it('should use cdk directly for deploy and destroy targets by default', async () => {
    await tsInfraGenerator(tree, options);
    const config = readProjectConfiguration(tree, '@proj/test');
    expect(config.targets.deploy.options.command).toBe(
      'cdk deploy --require-approval=never',
    );
    expect(config.targets.deploy.options.cwd).toBe('{projectRoot}');
    expect(config.targets.destroy.options.command).toBe(
      'cdk destroy --require-approval=never',
    );
    expect(config.targets.destroy.options.cwd).toBe('{projectRoot}');
  });

  it('should not import from infra-config in main.ts by default', async () => {
    await tsInfraGenerator(tree, options);
    const mainTs = tree.read('packages/test/src/main.ts').toString();
    expect(mainTs).not.toContain('infra-config');
    expect(mainTs).not.toContain('resolveStage');
    expect(mainTs).toContain('process.env.CDK_DEFAULT_ACCOUNT');
    expect(mainTs).toContain('process.env.CDK_DEFAULT_REGION');
  });

  it('should not add infra-config tsconfig reference by default', async () => {
    await tsInfraGenerator(tree, options);
    const tsConfig = readJson(tree, 'packages/test/tsconfig.lib.json');
    const refPaths = tsConfig.references.map((r: { path: string }) => r.path);
    expect(refPaths.some((p: string) => p.includes('infra-config'))).toBe(
      false,
    );
  });

  describe('with enableStageConfig', () => {
    const stageConfigOptions: TsInfraGeneratorSchema = {
      ...options,
      enableStageConfig: true,
    };

    it('should use tsx infra-deploy/infra-destroy for deploy and destroy targets', async () => {
      await tsInfraGenerator(tree, stageConfigOptions);
      const config = readProjectConfiguration(tree, '@proj/test');
      expect(config.targets.deploy.options.command).toBe(
        'tsx packages/common/scripts/src/infra-deploy.ts packages/test',
      );
      expect(config.targets.destroy.options.command).toBe(
        'tsx packages/common/scripts/src/infra-destroy.ts packages/test',
      );
    });

    it('should generate infra-config package with stages types and config', async () => {
      await tsInfraGenerator(tree, stageConfigOptions);
      expect(
        tree.exists('packages/common/infra-config/src/stages.config.ts'),
      ).toBeTruthy();
      expect(
        tree.exists('packages/common/infra-config/src/stages.types.ts'),
      ).toBeTruthy();
      // Verify types file has the discriminated union
      const typesContent = tree
        .read('packages/common/infra-config/src/stages.types.ts')
        .toString();
      expect(typesContent).toContain("type: 'profile'");
      expect(typesContent).toContain("type: 'assumeRole'");
      expect(typesContent).toContain('StageCredentials');
      expect(typesContent).toContain('StagesConfig');
    });

    it('should not overwrite existing infra-config files', async () => {
      // Pre-create infra-config with custom content
      tree.write('packages/common/infra-config/project.json', '{}');
      tree.write(
        'packages/common/infra-config/src/stages.config.ts',
        '// custom config\n',
      );
      await tsInfraGenerator(tree, stageConfigOptions);
      // Should preserve the existing files
      expect(
        tree
          .read('packages/common/infra-config/src/stages.config.ts')
          .toString(),
      ).toBe('// custom config\n');
    });

    it('should not overwrite existing scripts package', async () => {
      // Pre-create scripts with project.json to trigger early return
      tree.write('packages/common/scripts/project.json', '{}');
      tree.write(
        'packages/common/scripts/src/infra-deploy.ts',
        '// custom deploy\n',
      );
      await tsInfraGenerator(tree, stageConfigOptions);
      // Should preserve the existing files
      expect(
        tree.read('packages/common/scripts/src/infra-deploy.ts').toString(),
      ).toBe('// custom deploy\n');
    });

    it('should generate scripts package with deploy and destroy scripts', async () => {
      await tsInfraGenerator(tree, stageConfigOptions);
      expect(
        tree.exists('packages/common/scripts/src/infra-deploy.ts'),
      ).toBeTruthy();
      expect(
        tree.exists('packages/common/scripts/src/infra-destroy.ts'),
      ).toBeTruthy();
    });

    it('should import resolveStage from infra-config in main.ts', async () => {
      await tsInfraGenerator(tree, stageConfigOptions);
      const mainTs = tree.read('packages/test/src/main.ts').toString();
      expect(mainTs).toContain('infra-config');
      expect(mainTs).toContain('resolveStage');
    });

    it('should add infra-config tsconfig reference', async () => {
      await tsInfraGenerator(tree, stageConfigOptions);
      const tsConfig = readJson(tree, 'packages/test/tsconfig.lib.json');
      const refPaths = tsConfig.references.map((r: { path: string }) => r.path);
      expect(refPaths.some((p: string) => p.includes('infra-config'))).toBe(
        true,
      );
    });

    it('should add @aws-sdk/client-sts as dev dependency', async () => {
      await tsInfraGenerator(tree, stageConfigOptions);
      const packageJson = JSON.parse(tree.read('package.json').toString());
      expect(packageJson.devDependencies['@aws-sdk/client-sts']).toBeDefined();
    });

    it('should configure deploy and destroy targets with tsx scripts', async () => {
      await tsInfraGenerator(tree, stageConfigOptions);
      const config = readProjectConfiguration(tree, '@proj/test');
      expect(config.targets.deploy).toMatchObject({
        executor: 'nx:run-commands',
        dependsOn: ['^build', 'compile'],
        options: {
          command:
            'tsx packages/common/scripts/src/infra-deploy.ts packages/test',
        },
      });
      expect(config.targets.destroy).toMatchObject({
        executor: 'nx:run-commands',
        dependsOn: ['^build', 'compile'],
        options: {
          command:
            'tsx packages/common/scripts/src/infra-destroy.ts packages/test',
        },
      });
    });

    it('should snapshot generated infra-config src directory', async () => {
      await tsInfraGenerator(tree, stageConfigOptions);
      snapshotTreeDir(tree, 'packages/common/infra-config/src');
    });

    it('should snapshot generated scripts src directory', async () => {
      await tsInfraGenerator(tree, stageConfigOptions);
      snapshotTreeDir(tree, 'packages/common/scripts/src');
    });
  });
});
