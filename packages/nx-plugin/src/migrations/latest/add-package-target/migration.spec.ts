/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  type ProjectConfiguration,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { INFRA_APP_GENERATOR_INFO } from '../../../infra/app/generator.js';
import { TERRAFORM_PROJECT_GENERATOR_INFO } from '../../../terraform/project/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

/** The deploy targets as the pre-migration generator vended them. */
const cdkDeployTarget = () => ({
  executor: 'nx:run-commands',
  dependsOn: ['^build', 'compile'],
  options: { cwd: '{projectRoot}', command: 'cdk deploy' },
});

/** Seeds a CDK infrastructure project as the pre-migration generator left it. */
const seedInfraProject = (
  tree: Tree,
  {
    name = '@proj/infra',
    overrides = {},
  }: { name?: string; overrides?: object } = {},
) =>
  addProjectConfiguration(tree, name, {
    root: 'packages/infra',
    projectType: 'application',
    metadata: { generator: INFRA_APP_GENERATOR_INFO.id } as never,
    targets: {
      build: { dependsOn: ['lint', 'compile', 'test', 'synth', 'checkov'] },
      compile: { executor: 'nx:run-commands' },
      synth: { executor: 'nx:run-commands', dependsOn: ['^build', 'compile'] },
      checkov: { executor: 'nx:run-commands', dependsOn: ['synth'] },
      deploy: cdkDeployTarget(),
      'deploy-sandbox': cdkDeployTarget(),
      'deploy-ci': { executor: 'nx:run-commands' },
      destroy: cdkDeployTarget(),
      'destroy-sandbox': cdkDeployTarget(),
      ...overrides,
    },
  });

/** Seeds a Terraform project as the pre-migration generator left it. */
const seedTerraformProject = (
  tree: Tree,
  {
    name = '@proj/tf-app',
    projectType = 'application' as ProjectConfiguration['projectType'],
    buildDependsOn = ['fmt', 'checkov', 'test', '@proj/terraform:build'],
  } = {},
) =>
  addProjectConfiguration(tree, name, {
    root: 'packages/tf-app',
    projectType,
    metadata: { generator: TERRAFORM_PROJECT_GENERATOR_INFO.id } as never,
    targets: {
      build: { dependsOn: buildDependsOn },
      plan: { dependsOn: ['init', 'validate', '^validate', 'build'] },
      apply: { dependsOn: ['plan'] },
    },
  });

const targetsOf = (tree: Tree, project: string) =>
  readProjectConfiguration(tree, project).targets;

describe('add-package-target migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('package target', () => {
    it('should carry the artifact dependencies of build and none of its gates', async () => {
      addProjectConfiguration(tree, '@proj/api', {
        root: 'packages/api',
        targets: {
          build: { dependsOn: ['lint', 'compile', 'test', 'bundle'] },
        },
      });

      await migration(tree);

      expect(targetsOf(tree, '@proj/api').package).toEqual({
        dependsOn: ['compile', 'bundle'],
      });
    });

    it('should mirror cross-project build edges against their package', async () => {
      addProjectConfiguration(tree, '@proj/common-constructs', {
        root: 'packages/common/constructs',
        targets: {
          build: {
            dependsOn: [
              'lint',
              'compile',
              'test',
              '@proj/api:build',
              '@proj/website:build',
            ],
          },
        },
      });

      await migration(tree);

      expect(targetsOf(tree, '@proj/common-constructs').package).toEqual({
        dependsOn: ['compile', '@proj/api:package', '@proj/website:package'],
      });
    });

    it('should be a no-op target when build only runs quality gates', async () => {
      addProjectConfiguration(tree, '@proj/gates-only', {
        root: 'packages/gates-only',
        targets: { build: { dependsOn: ['lint', 'test'] } },
      });

      await migration(tree);

      expect(targetsOf(tree, '@proj/gates-only').package).toEqual({
        executor: 'nx:noop',
      });
    });

    it('should keep build untouched, so it still runs everything', async () => {
      const build = ['lint', 'compile', 'test', 'bundle', 'docker'];
      addProjectConfiguration(tree, '@proj/api', {
        root: 'packages/api',
        targets: { build: { dependsOn: [...build] } },
      });

      await migration(tree);

      expect(targetsOf(tree, '@proj/api').build.dependsOn).toEqual(build);
    });
  });

  describe('CDK infrastructure projects', () => {
    it('should point the deploy family at ^package', async () => {
      seedInfraProject(tree);

      await migration(tree);
      const targets = targetsOf(tree, '@proj/infra');

      for (const name of [
        'synth',
        'deploy',
        'deploy-sandbox',
        'destroy',
        'destroy-sandbox',
      ]) {
        expect(targets[name].dependsOn).toEqual(['^package', 'compile']);
      }
    });

    it('should produce the cloud assembly from package but not scan it', async () => {
      seedInfraProject(tree);

      await migration(tree);

      // `synth` is the artifact; `checkov` scans it and stays a build-only gate.
      expect(targetsOf(tree, '@proj/infra').package.dependsOn).toContain(
        'synth',
      );
      expect(targetsOf(tree, '@proj/infra').package.dependsOn).not.toContain(
        'checkov',
      );
    });

    it('should leave deploy-ci alone, which consumes a prebuilt assembly', async () => {
      seedInfraProject(tree);

      await migration(tree);

      expect(targetsOf(tree, '@proj/infra')['deploy-ci']).toEqual({
        executor: 'nx:run-commands',
      });
    });
  });

  describe('Terraform projects', () => {
    it('should point plan at package rather than build', async () => {
      seedTerraformProject(tree);

      await migration(tree);

      expect(targetsOf(tree, '@proj/tf-app').plan.dependsOn).toEqual([
        'init',
        'validate',
        '^validate',
        'package',
      ]);
    });

    it('should keep checkov on the plan path but drop the module tests', async () => {
      seedTerraformProject(tree);

      await migration(tree);

      const pkg = targetsOf(tree, '@proj/tf-app').package;
      expect(pkg.dependsOn).toContain('checkov');
      expect(pkg.dependsOn).toContain('@proj/terraform:package');
      expect(pkg.dependsOn).not.toContain('test');
      expect(pkg.dependsOn).not.toContain('fmt');
    });

    it('should scan a library, which vends modules the applications plan', async () => {
      seedTerraformProject(tree, {
        name: '@proj/tf-lib',
        projectType: 'library',
        buildDependsOn: ['fmt', 'checkov', 'test'],
      });

      await migration(tree);

      expect(targetsOf(tree, '@proj/tf-lib').package.dependsOn).toEqual([
        'checkov',
      ]);
    });

    it('should keep the shared project cross-project artifact edges', async () => {
      seedTerraformProject(tree, {
        name: '@proj/terraform',
        projectType: 'library',
        buildDependsOn: [
          'fmt',
          'checkov',
          'test',
          '@proj/ts-api:build',
          '@proj/ts-api:operations',
          'generate:py-api-operations',
          '@proj/web:build',
        ],
      });

      await migration(tree);

      // The shared Terraform project reads the artifacts of everything it
      // deploys, so a library's package cannot be a blanket no-op.
      expect(targetsOf(tree, '@proj/terraform').package.dependsOn).toEqual([
        'checkov',
        '@proj/ts-api:package',
        '@proj/ts-api:operations',
        'generate:py-api-operations',
        '@proj/web:package',
      ]);
    });
  });

  describe('website compile', () => {
    it('should narrow ^build to ^compile so upstream gates stay out', async () => {
      addProjectConfiguration(tree, '@proj/website', {
        root: 'packages/website',
        targets: {
          build: { dependsOn: ['lint', 'compile', 'test', 'bundle'] },
          compile: {
            dependsOn: ['^build', 'generate:api-client'],
            executor: 'nx:run-commands',
          },
        },
      });

      await migration(tree);

      expect(targetsOf(tree, '@proj/website').compile.dependsOn).toEqual([
        '^compile',
        'generate:api-client',
      ]);
    });
  });

  describe('divergence', () => {
    it('should report a build declaring an unrecognised dependency', async () => {
      addProjectConfiguration(tree, '@proj/custom', {
        root: 'packages/custom',
        targets: {
          build: { dependsOn: ['lint', 'compile', 'my-custom-step'] },
        },
      });

      const result = await migration(tree);

      expect(targetsOf(tree, '@proj/custom').package).toBeUndefined();
      expect(result.nextSteps).toEqual([
        expect.stringContaining('@proj/custom'),
      ]);
    });

    it('should not clobber a package target the user already authors', async () => {
      const authored = {
        executor: '@nx/js:tsc',
        options: { outputPath: 'dist/packages/plugin/package' },
      };
      addProjectConfiguration(tree, '@proj/plugin', {
        root: 'packages/plugin',
        targets: {
          build: { dependsOn: ['lint', 'compile', 'test', 'package'] },
          package: authored,
        },
      });

      await migration(tree);

      expect(targetsOf(tree, '@proj/plugin').package).toEqual(authored);
    });

    it('should report a deploy target that no longer depends on ^build', async () => {
      seedInfraProject(tree, {
        overrides: {
          deploy: {
            executor: 'nx:run-commands',
            dependsOn: ['my-own-prep'],
          },
        },
      });

      const result = await migration(tree);

      expect(targetsOf(tree, '@proj/infra').deploy.dependsOn).toEqual([
        'my-own-prep',
      ]);
      expect(result.nextSteps).toEqual([expect.stringContaining("'deploy'")]);
    });

    it('should report a plan target that no longer depends on build', async () => {
      addProjectConfiguration(tree, '@proj/tf-app', {
        root: 'packages/tf-app',
        projectType: 'application',
        metadata: { generator: TERRAFORM_PROJECT_GENERATOR_INFO.id } as never,
        targets: {
          build: { dependsOn: ['fmt', 'checkov', 'test'] },
          plan: { dependsOn: ['init', 'validate'] },
        },
      });

      const result = await migration(tree);

      expect(targetsOf(tree, '@proj/tf-app').plan.dependsOn).toEqual([
        'init',
        'validate',
      ]);
      expect(result.nextSteps).toEqual([expect.stringContaining("'plan'")]);
    });
  });

  it('should be idempotent', async () => {
    seedInfraProject(tree);
    seedTerraformProject(tree);
    addProjectConfiguration(tree, '@proj/api', {
      root: 'packages/api',
      targets: {
        build: { dependsOn: ['lint', 'compile', 'test', 'bundle'] },
        compile: { dependsOn: ['^build'], executor: 'nx:run-commands' },
      },
    });

    const first = await migration(tree);
    const after = ['@proj/infra', '@proj/tf-app', '@proj/api'].map((p) =>
      JSON.stringify(targetsOf(tree, p)),
    );

    const second = await migration(tree);

    expect(
      ['@proj/infra', '@proj/tf-app', '@proj/api'].map((p) =>
        JSON.stringify(targetsOf(tree, p)),
      ),
    ).toEqual(after);
    expect(second.nextSteps).toEqual(first.nextSteps);
  });
});
