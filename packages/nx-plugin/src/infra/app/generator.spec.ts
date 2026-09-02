/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  readJson,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { expectHasMetricTags } from '../../utils/metrics-assertions.js';
import { toKebabCase } from '../../utils/names.js';
import {
  createTreeUsingTsSolutionSetup,
  snapshotTreeDir,
} from '../../utils/test.js';
import { INFRA_APP_GENERATOR_INFO, tsInfraGenerator } from './generator.js';
import type { TsInfraGeneratorSchema } from './schema';

describe('infra generator', () => {
  let tree: Tree;

  const options: TsInfraGeneratorSchema = {
    name: 'test',
    directory: 'packages',
    preferInstallDependencies: false,
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
      dependsOn: ['^assemble', 'compile'],
      options: {
        cwd: '{projectRoot}',
        command: 'cdk synth',
      },
    });
    // Default (stageConfig=false): deploy uses cdk directly
    expect(config.targets.deploy).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command: 'cdk deploy --require-approval=never --express',
      },
      dependsOn: ['^assemble', 'compile'],
    });
    expect(config.targets['deploy-sandbox']).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command:
          'cdk deploy --require-approval=never "proj-test-sandbox/*" --express',
      },
      dependsOn: ['^assemble', 'compile'],
    });
    expect(config.targets['deploy-ci']).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command:
          'cdk deploy --require-approval=never --app ../../dist/{projectRoot}/cdk.out',
      },
    });
    // Default (stageConfig=false): destroy uses cdk directly
    expect(config.targets.destroy).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command: 'cdk destroy',
      },
      dependsOn: ['^assemble', 'compile'],
    });
    expect(config.targets['destroy-sandbox']).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command: 'cdk destroy "proj-test-sandbox/*"',
      },
      dependsOn: ['^assemble', 'compile'],
    });
    expect(config.targets['destroy-ci']).toMatchObject({
      executor: 'nx:run-commands',
      options: {
        cwd: '{projectRoot}',
        command: 'cdk destroy --app ../../dist/{projectRoot}/cdk.out',
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
        command: expect.stringContaining('uvx --from checkov=='),
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
    // Runtime dependencies live in the infra project's own package.json as
    // catalog references; build tooling (aws-cdk CLI, esbuild, tsx) stays at
    // the workspace root.
    const infraPackageJson = JSON.parse(
      tree.read('packages/test/package.json').toString(),
    );
    expect(infraPackageJson.dependencies).toMatchObject({
      'aws-cdk-lib': 'catalog:',
      constructs: 'catalog:',
      'source-map-support': 'catalog:',
    });
    expect(packageJson.devDependencies).toMatchObject({
      'aws-cdk': 'catalog:',
      esbuild: 'catalog:',
      tsx: 'catalog:',
    });
  });

  it('should handle custom project names correctly', async () => {
    const customOptions: TsInfraGeneratorSchema = {
      name: 'custom-infra',
      directory: 'packages',
      preferInstallDependencies: false,
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
      'cdk deploy --require-approval=never --express',
    );
    expect(config.targets.deploy.options.cwd).toBe('{projectRoot}');
    expect(config.targets.destroy.options.command).toBe('cdk destroy');
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

  it('should invite further stages below the sandbox stage in main.ts', async () => {
    await tsInfraGenerator(tree, options);
    const mainTs = tree.read('packages/test/src/main.ts').toString();
    expect(mainTs).toContain(
      '// Define other instances of stages, such as beta and prod, below',
    );
    // The comment sits after the sandbox stage and before app.synth().
    expect(
      mainTs.indexOf('// Define other instances of stages'),
    ).toBeGreaterThan(
      mainTs.indexOf("new ApplicationStage(app, 'proj-test-sandbox'"),
    );
    expect(mainTs.indexOf('// Define other instances of stages')).toBeLessThan(
      mainTs.indexOf('app.synth()'),
    );
  });

  // `cdk destroy` has no --require-approval or --express option, so only
  // deploys carry them.
  describe.each([
    {
      action: 'deploy',
      cdkCommand: 'cdk deploy --require-approval=never',
      // Trails the stage pattern so the pattern stays the first positional arg.
      suffix: ' --express',
    },
    { action: 'destroy', cdkCommand: 'cdk destroy', suffix: '' },
  ])('$action-sandbox target', ({ action, cdkCommand, suffix }) => {
    const target = `${action}-sandbox`;

    // The stage pattern must match the stage main.ts instantiates, otherwise
    // cdk acts on nothing. Derived from the scope-prefixed project name.
    it.each([
      { name: 'test', subDirectory: undefined, stage: 'proj-test-sandbox' },
      { name: 'infra', subDirectory: undefined, stage: 'proj-infra-sandbox' },
      {
        name: 'myInfra',
        subDirectory: undefined,
        stage: 'proj-my-infra-sandbox',
      },
      { name: 'test', subDirectory: 'nested', stage: 'proj-test-sandbox' },
    ])(
      'should target the stage main.ts declares for $name in $subDirectory',
      async ({ name, subDirectory, stage }) => {
        await tsInfraGenerator(tree, { ...options, name, subDirectory });
        // The project name is the kebab-cased name under the workspace scope.
        const config = readProjectConfiguration(
          tree,
          `@proj/${toKebabCase(name)}`,
        );
        const mainTs = tree.read(`${config.root}/src/main.ts`).toString();

        expect(mainTs).toContain(`new ApplicationStage(app, '${stage}'`);
        expect(config.targets[target].options.command).toBe(
          `${cdkCommand} "${stage}/*"${suffix}`,
        );
      },
    );

    it('should quote the stage pattern so the shell does not glob it', async () => {
      await tsInfraGenerator(tree, options);
      const config = readProjectConfiguration(tree, '@proj/test');
      expect(config.targets[target].options.command).toContain(
        '"proj-test-sandbox/*"',
      );
    });

    it(`should assemble first, like the ${action} target`, async () => {
      await tsInfraGenerator(tree, options);
      const config = readProjectConfiguration(tree, '@proj/test');
      expect(config.targets[target].dependsOn).toEqual([
        '^assemble',
        'compile',
      ]);
    });
  });

  it('should not add infra-config tsconfig reference by default', async () => {
    await tsInfraGenerator(tree, options);
    const tsConfig = readJson(tree, 'packages/test/tsconfig.lib.json');
    const refPaths = tsConfig.references.map((r: { path: string }) => r.path);
    expect(refPaths.some((p: string) => p.includes('infra-config'))).toBe(
      false,
    );
  });

  describe('with stageConfig', () => {
    const stageConfigOptions: TsInfraGeneratorSchema = {
      ...options,
      stageConfig: true,
    };

    it('should use tsx infra-deploy/infra-destroy for deploy and destroy targets', async () => {
      await tsInfraGenerator(tree, stageConfigOptions);
      const config = readProjectConfiguration(tree, '@proj/test');
      // No --express: this target deploys whichever stage is named.
      expect(config.targets.deploy.options.command).toBe(
        'tsx packages/common/scripts/src/infra/infra-deploy.ts packages/test',
      );
      expect(config.targets.destroy.options.command).toBe(
        'tsx packages/common/scripts/src/infra/infra-destroy.ts packages/test',
      );
    });

    it.each(['deploy', 'destroy'] as const)(
      'should pass the sandbox stage to infra-%s for %s-sandbox',
      async (action) => {
        await tsInfraGenerator(tree, stageConfigOptions);
        const config = readProjectConfiguration(tree, '@proj/test');
        // The stage is the first positional arg after the project path, which is
        // where the script looks it up in stages.config.ts - so any flags must
        // trail it.
        expect(config.targets[`${action}-sandbox`].options.command).toBe(
          `tsx packages/common/scripts/src/infra/infra-${action}.ts packages/test "proj-test-sandbox/*"${action === 'deploy' ? ' --express' : ''}`,
        );
        expect(config.targets[`${action}-sandbox`].dependsOn).toEqual([
          '^assemble',
          'compile',
        ]);
      },
    );

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
        'packages/common/scripts/package.json',
        JSON.stringify({
          name: '@proj/scripts',
          version: '0.0.0',
          private: true,
          type: 'module',
        }),
      );
      tree.write(
        'packages/common/scripts/src/infra/infra-deploy.ts',
        '// custom deploy\n',
      );
      await tsInfraGenerator(tree, stageConfigOptions);
      // Should preserve the existing files
      expect(
        tree
          .read('packages/common/scripts/src/infra/infra-deploy.ts')
          .toString(),
      ).toBe('// custom deploy\n');
    });

    it('should generate scripts package with deploy and destroy scripts', async () => {
      await tsInfraGenerator(tree, stageConfigOptions);
      expect(
        tree.exists('packages/common/scripts/src/infra/infra-deploy.ts'),
      ).toBeTruthy();
      expect(
        tree.exists('packages/common/scripts/src/infra/infra-destroy.ts'),
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

    it('should add @aws-sdk/client-sts to the shared scripts project', async () => {
      await tsInfraGenerator(tree, stageConfigOptions);
      const scriptsPackageJson = JSON.parse(
        tree.read('packages/common/scripts/package.json').toString(),
      );
      expect(scriptsPackageJson.devDependencies['@aws-sdk/client-sts']).toBe(
        'catalog:',
      );
    });

    it('should configure deploy and destroy targets with tsx scripts', async () => {
      await tsInfraGenerator(tree, stageConfigOptions);
      const config = readProjectConfiguration(tree, '@proj/test');
      expect(config.targets.deploy).toMatchObject({
        executor: 'nx:run-commands',
        dependsOn: ['^assemble', 'compile'],
        options: {
          command:
            'tsx packages/common/scripts/src/infra/infra-deploy.ts packages/test',
        },
      });
      expect(config.targets.destroy).toMatchObject({
        executor: 'nx:run-commands',
        dependsOn: ['^assemble', 'compile'],
        options: {
          command:
            'tsx packages/common/scripts/src/infra/infra-destroy.ts packages/test',
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

  it('should place project in subDirectory when provided', async () => {
    await tsInfraGenerator(tree, {
      ...options,
      directory: 'packages',
      subDirectory: 'infra',
    });
    expect(tree.exists('packages/infra')).toBeTruthy();
    expect(tree.exists('packages/infra/src')).toBeTruthy();
    expect(tree.exists('packages/infra/cdk.json')).toBeTruthy();
  });

  it('should be idempotent when re-run with same options', async () => {
    await tsInfraGenerator(tree, options);

    const projectCountAfterFirstRun = getProjects(tree).size;
    const mainTsAfterFirstRun = tree.read('packages/test/src/main.ts', 'utf-8');

    await expect(tsInfraGenerator(tree, options)).resolves.toBeDefined();

    expect(getProjects(tree).size).toBe(projectCountAfterFirstRun);
    expect(tree.read('packages/test/src/main.ts', 'utf-8')).toEqual(
      mainTsAfterFirstRun,
    );
  });

  it('should create an independent project when run with a different name', async () => {
    await tsInfraGenerator(tree, options);
    await tsInfraGenerator(tree, { ...options, name: 'other' });

    expect(readProjectConfiguration(tree, '@proj/test')).toBeDefined();
    expect(readProjectConfiguration(tree, '@proj/other')).toBeDefined();
    expect(tree.exists('packages/other/cdk.json')).toBeTruthy();
  });

  describe('assemble target', () => {
    it('should produce the cloud assembly without the build quality gates', async () => {
      await tsInfraGenerator(tree, options);
      const config = readProjectConfiguration(tree, '@proj/test');

      // `synth` is the deployable artifact, so it belongs on assemble; lint,
      // test and checkov are quality gates, which stay on build alone.
      expect(config.targets.assemble.dependsOn).toContain('synth');
      expect(config.targets.assemble.dependsOn).not.toContain('lint');
      expect(config.targets.assemble.dependsOn).not.toContain('test');
      expect(config.targets.assemble.dependsOn).not.toContain('checkov');
    });

    it('should keep build running every quality gate', async () => {
      await tsInfraGenerator(tree, options);
      const config = readProjectConfiguration(tree, '@proj/test');

      // Narrowing the deploy path must not narrow `build`, which is still the
      // target that runs everything.
      for (const gate of ['lint', 'test', 'synth', 'checkov']) {
        expect(config.targets.build.dependsOn).toContain(gate);
      }
    });

    it('should not grow either target on a re-run', async () => {
      await tsInfraGenerator(tree, options);
      const first = readProjectConfiguration(tree, '@proj/test');
      const build = [...first.targets.build.dependsOn];
      const assemble = [...first.targets.assemble.dependsOn];

      await tsInfraGenerator(tree, options);
      const second = readProjectConfiguration(tree, '@proj/test');

      expect(second.targets.build.dependsOn).toEqual(build);
      expect(second.targets.assemble.dependsOn).toEqual(assemble);
    });
  });
});
