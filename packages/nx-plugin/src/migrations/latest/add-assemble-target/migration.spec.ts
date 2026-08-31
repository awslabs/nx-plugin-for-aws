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
import { REACT_WEBSITE_APP_GENERATOR_INFO } from '../../../ts/react-website/app/generator.js';
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

describe('add-assemble-target migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('assemble target', () => {
    it('should carry the artifact dependencies of build and none of its gates', async () => {
      addProjectConfiguration(tree, '@proj/api', {
        root: 'packages/api',
        targets: {
          build: { dependsOn: ['lint', 'compile', 'test', 'bundle'] },
        },
      });

      await migration(tree);

      expect(targetsOf(tree, '@proj/api').assemble).toEqual({
        dependsOn: ['compile', 'bundle'],
      });
    });

    it('should mirror cross-project build edges against their assemble', async () => {
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

      expect(targetsOf(tree, '@proj/common-constructs').assemble).toEqual({
        dependsOn: ['compile', '@proj/api:assemble', '@proj/website:assemble'],
      });
    });

    it('should be a no-op target when build only runs quality gates', async () => {
      addProjectConfiguration(tree, '@proj/gates-only', {
        root: 'packages/gates-only',
        targets: { build: { dependsOn: ['lint', 'test'] } },
      });

      await migration(tree);

      expect(targetsOf(tree, '@proj/gates-only').assemble).toEqual({
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
    it('should point the deploy family at ^assemble', async () => {
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
        expect(targets[name].dependsOn).toEqual(['^assemble', 'compile']);
      }
    });

    it('should produce the cloud assembly from assemble but not scan it', async () => {
      seedInfraProject(tree);

      await migration(tree);

      // `synth` is the artifact; `checkov` scans it and stays a build-only gate.
      expect(targetsOf(tree, '@proj/infra').assemble.dependsOn).toContain(
        'synth',
      );
      expect(targetsOf(tree, '@proj/infra').assemble.dependsOn).not.toContain(
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
    it('should point plan at assemble rather than build', async () => {
      seedTerraformProject(tree);

      await migration(tree);

      expect(targetsOf(tree, '@proj/tf-app').plan.dependsOn).toEqual([
        'init',
        'validate',
        '^validate',
        'assemble',
      ]);
    });

    it('should keep checkov on the plan path but drop the module tests', async () => {
      seedTerraformProject(tree);

      await migration(tree);

      const assemble = targetsOf(tree, '@proj/tf-app').assemble;
      expect(assemble.dependsOn).toContain('checkov');
      expect(assemble.dependsOn).toContain('@proj/terraform:assemble');
      expect(assemble.dependsOn).not.toContain('test');
      expect(assemble.dependsOn).not.toContain('fmt');
    });

    it('should scan a library, which vends modules the applications plan', async () => {
      seedTerraformProject(tree, {
        name: '@proj/tf-lib',
        projectType: 'library',
        buildDependsOn: ['fmt', 'checkov', 'test'],
      });

      await migration(tree);

      expect(targetsOf(tree, '@proj/tf-lib').assemble.dependsOn).toEqual([
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
      // deploys, so a library's assemble cannot be a blanket no-op.
      expect(targetsOf(tree, '@proj/terraform').assemble.dependsOn).toEqual([
        'checkov',
        '@proj/ts-api:assemble',
        '@proj/ts-api:operations',
        'generate:py-api-operations',
        '@proj/web:assemble',
      ]);
    });
  });

  describe('website compile', () => {
    it('should narrow ^build to ^compile so upstream gates stay out', async () => {
      addProjectConfiguration(tree, '@proj/website', {
        root: 'packages/website',
        metadata: { generator: REACT_WEBSITE_APP_GENERATOR_INFO.id } as never,
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

  describe('artifact target classification', () => {
    it('should carry the RDB bundles, which build registers directly', async () => {
      // `py#rdb` registers bundle-migration and bundle-create-db-user on build
      // itself, not only on bundle.
      addProjectConfiguration(tree, 'proj.db', {
        root: 'packages/db',
        targets: {
          build: {
            dependsOn: [
              'lint',
              'compile',
              'test',
              'typecheck',
              'bundle',
              'bundle-migration',
              'bundle-create-db-user',
            ],
          },
        },
      });

      const result = await migration(tree);

      expect(targetsOf(tree, 'proj.db').assemble).toEqual({
        dependsOn: [
          'compile',
          'bundle',
          'bundle-migration',
          'bundle-create-db-user',
        ],
      });
      expect(result.nextSteps).toEqual([]);
    });

    it('should leave a consumed project no dangling assemble edge', async () => {
      // Nx silently skips a dependency on a target that does not exist, so a
      // consumed project must always end up with the `assemble` its consumers
      // were repointed at.
      addProjectConfiguration(tree, 'proj.db', {
        root: 'packages/db',
        targets: {
          build: {
            dependsOn: ['lint', 'compile', 'test', 'bundle-migration'],
          },
        },
      });
      addProjectConfiguration(tree, '@proj/common-constructs', {
        root: 'packages/common/constructs',
        targets: {
          build: { dependsOn: ['lint', 'compile', 'test', 'proj.db:build'] },
        },
      });

      await migration(tree);

      const consumer = targetsOf(tree, '@proj/common-constructs').assemble;
      expect(consumer.dependsOn).toContain('proj.db:assemble');
      expect(targetsOf(tree, 'proj.db').assemble).toBeDefined();
    });

    it('should accept the object form of dependsOn', async () => {
      addProjectConfiguration(tree, '@proj/api', {
        root: 'packages/api',
        targets: {
          build: {
            dependsOn: [
              'lint',
              'compile',
              'bundle',
              { projects: ['@proj/shared'], target: 'build' },
              { projects: ['@proj/other'], target: 'compile' },
              { projects: ['@proj/lint-only'], target: 'lint' },
            ],
          },
        },
      });

      const result = await migration(tree);

      expect(targetsOf(tree, '@proj/api').assemble.dependsOn).toEqual([
        'compile',
        'bundle',
        { projects: ['@proj/shared'], target: 'assemble' },
        { projects: ['@proj/other'], target: 'compile' },
      ]);
      expect(result.nextSteps).toEqual([]);
    });
  });

  describe('projects with nothing to derive', () => {
    it('should be a no-op for a build declaring no dependencies', async () => {
      // `ts#astro-docs` runs `astro build` directly, with no dependsOn.
      addProjectConfiguration(tree, '@proj/docs', {
        root: 'packages/docs',
        targets: {
          build: {
            executor: 'nx:run-commands',
            options: { command: 'astro build' },
          },
        },
      });

      const result = await migration(tree);

      expect(targetsOf(tree, '@proj/docs').assemble).toEqual({
        executor: 'nx:noop',
      });
      expect(result.nextSteps).toEqual([]);
    });

    it('should be a no-op for a project with no build target', async () => {
      addProjectConfiguration(tree, '@proj/lint-only', {
        root: 'packages/lint-only',
        targets: { lint: { executor: 'nx:run-commands' } },
      });

      const result = await migration(tree);

      expect(targetsOf(tree, '@proj/lint-only').assemble).toBeUndefined();
      expect(result.nextSteps).toEqual([]);
    });
  });

  describe('compile narrowing', () => {
    it('should not report narrowing a generated website', async () => {
      addProjectConfiguration(tree, '@proj/website', {
        root: 'packages/website',
        metadata: { generator: REACT_WEBSITE_APP_GENERATOR_INFO.id } as never,
        targets: {
          build: { dependsOn: ['lint', 'compile', 'test', 'bundle'] },
          compile: { dependsOn: ['^build'], executor: 'nx:run-commands' },
        },
      });

      const result = await migration(tree);

      expect(targetsOf(tree, '@proj/website').compile.dependsOn).toEqual([
        '^compile',
      ]);
      expect(result.nextSteps).toEqual([]);
    });

    it('should report narrowing a project the plugin did not generate', async () => {
      addProjectConfiguration(tree, '@proj/hand-written', {
        root: 'packages/hand-written',
        targets: {
          build: { dependsOn: ['lint', 'compile', 'test'] },
          compile: { dependsOn: ['^build'], executor: 'nx:run-commands' },
        },
      });

      const result = await migration(tree);

      expect(targetsOf(tree, '@proj/hand-written').compile.dependsOn).toEqual([
        '^compile',
      ]);
      expect(result.nextSteps).toEqual([
        expect.stringContaining('@proj/hand-written'),
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

      expect(targetsOf(tree, '@proj/custom').assemble).toBeUndefined();
      // The report must say consumers were already repointed, since Nx skips a
      // dependency on a missing target silently.
      expect(result.nextSteps).toEqual([
        expect.stringContaining("'@proj/custom:assemble'"),
      ]);
      expect(result.nextSteps[0]).toContain('silently skips');
    });

    it('should leave a publishable package target untouched', async () => {
      // `package` publishes to a package manager, which is a different job from
      // assembling deployable artifacts. An Nx plugin project vends one.
      const authored = {
        executor: '@nx/js:tsc',
        outputs: ['{options.outputPath}'],
        options: { outputPath: 'dist/packages/plugin/package' },
      };
      addProjectConfiguration(tree, '@proj/plugin', {
        root: 'packages/plugin',
        targets: {
          build: { dependsOn: ['lint', 'compile', 'test', 'package'] },
          package: authored,
        },
      });

      const result = await migration(tree);

      expect(targetsOf(tree, '@proj/plugin').package).toEqual(authored);
      // `package` is not an artifact target, so it is not carried onto
      // `assemble`, and it is not a quality gate either — hence it is reported.
      expect(targetsOf(tree, '@proj/plugin').assemble).toBeUndefined();
      expect(result.nextSteps).toEqual([
        expect.stringContaining('@proj/plugin'),
      ]);
    });

    it('should not clobber an assemble target the user already authors', async () => {
      const authored = { executor: 'nx:noop' };
      addProjectConfiguration(tree, '@proj/custom-assemble', {
        root: 'packages/custom-assemble',
        targets: {
          build: { dependsOn: ['lint', 'compile', 'test', 'bundle'] },
          assemble: authored,
        },
      });

      await migration(tree);

      expect(targetsOf(tree, '@proj/custom-assemble').assemble).toEqual(
        authored,
      );
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
    // The first run narrowed `@proj/api`'s compile and reported doing so; the
    // second changes nothing, so it has nothing to report.
    expect(first.nextSteps).toEqual([
      expect.stringContaining("Narrowed 'compile' on @proj/api"),
    ]);
    expect(second.nextSteps).toEqual([]);
  });
});
