/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  readNxJson,
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as tsLibGenerator from '../../ts/lib/generator.js';
import * as gitUtils from '../../utils/git.js';
import { createTreeUsingTsSolutionSetup } from '../../utils/test.js';
import {
  TERRAFORM_PROJECT_GENERATOR_INFO,
  terraformProjectGenerator,
} from './generator.js';
import type { TerraformProjectGeneratorSchema } from './schema';

describe('terraformProjectGenerator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('application type', () => {
    const applicationSchema: TerraformProjectGeneratorSchema = {
      name: 'my-terraform-project',
      type: 'application',
      directory: 'packages',
    };

    it('should generate terraform application project with correct configuration', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      // Verify project configuration was added
      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );

      expect(projectConfig).toBeDefined();
      expect(projectConfig.root).toBe('packages/my-terraform-project');
      expect(projectConfig.projectType).toBe('application');
      expect(projectConfig.sourceRoot).toBe(
        'packages/my-terraform-project/src',
      );

      // Verify application-specific targets are present
      expect(projectConfig.targets).toHaveProperty('apply');
      expect(projectConfig.targets).toHaveProperty('bootstrap');
      expect(projectConfig.targets).toHaveProperty('bootstrap-destroy');
      expect(projectConfig.targets).toHaveProperty('deploy');
      expect(projectConfig.targets).toHaveProperty('destroy');
      expect(projectConfig.targets).toHaveProperty('init');
      expect(projectConfig.targets).toHaveProperty('plan');

      // Verify library targets are also present
      expect(projectConfig.targets).toHaveProperty('fmt');
      expect(projectConfig.targets).toHaveProperty('test');
      expect(projectConfig.targets).toHaveProperty('validate');
      expect(projectConfig.targets).toHaveProperty('output');
    });

    it('should keep every established target name and add checkov', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );

      // Renaming or dropping any of these breaks existing invocations, so the
      // full set is pinned. `checkov` matches the CDK app's scan target, which
      // is what lets `run-many --target checkov` reach Terraform projects too.
      expect(Object.keys(projectConfig.targets).sort()).toEqual([
        'apply',
        'bootstrap',
        'bootstrap-destroy',
        'build',
        'checkov',
        'deploy',
        'destroy',
        'fmt',
        'init',
        'output',
        'plan',
        'test',
        'validate',
      ]);
    });

    it('should pass the region to bootstrap-destroy so it never prompts', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );
      const bootstrapDestroyTarget = projectConfig.targets['bootstrap-destroy'];

      expect(bootstrapDestroyTarget.options.commands).toEqual([
        'tsx {projectRoot}/scripts/bootstrap-destroy.ts {projectRoot}',
      ]);
      expect(bootstrapDestroyTarget.options.cwd).toBe('{workspaceRoot}');

      // `aws_region` has no default, so a bare `terraform destroy` blocks
      // forever on its input prompt in any non-TTY context.
      const script = tree.read(
        'packages/my-terraform-project/scripts/bootstrap-destroy.ts',
        'utf-8',
      );
      expect(script).toContain('`-var=aws_region=${region}`');
      expect(script).toContain("'-auto-approve'");
      expect(script).toContain('resolveAwsConfig');
    });

    it('should vend a checkov config and wire it into the scan', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );

      expect(
        tree.exists('packages/my-terraform-project/checkov.yml'),
      ).toBeTruthy();
      expect(projectConfig.targets['checkov'].options.command).toContain(
        '--config-file ../checkov.yml',
      );
    });

    it('should preserve user-curated checkov skips on re-run', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      const checkovConfigPath = 'packages/my-terraform-project/checkov.yml';
      tree.write(checkovConfigPath, 'skip-check:\n  - CKV_AWS_999\n');

      await terraformProjectGenerator(tree, applicationSchema);

      expect(tree.read(checkovConfigPath, 'utf-8')).toContain('CKV_AWS_999');
    });

    it('should declare a required_version in both providers.tf', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      for (const providersPath of [
        'packages/my-terraform-project/src/providers.tf',
        'packages/my-terraform-project/bootstrap/providers.tf',
      ]) {
        expect(tree.read(providersPath, 'utf-8')).toContain(
          'required_version = ">= 1.0"',
        );
      }
    });

    it('should declare all dependencies at the root and vend no project package.json', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      // Terraform projects don't carry a package.json (only Node projects do).
      expect(
        tree.exists('packages/my-terraform-project/package.json'),
      ).toBeFalsy();

      // Build tooling and the AWS SDK the vended deploy scripts import both
      // live in the root manifest, where those scripts resolve them.
      const rootPackageJson = JSON.parse(tree.read('package.json', 'utf-8'));
      for (const dep of [
        '@nx-extend/terraform',
        'make-dir-cli',
        'tsx',
        '@aws-sdk/client-s3',
        '@aws-sdk/client-sts',
        '@aws-sdk/credential-providers',
        '@smithy/config-resolver',
        '@smithy/node-config-provider',
      ]) {
        expect(rootPackageJson.devDependencies[dep]).toBeDefined();
      }
    });

    it('should configure apply target correctly', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );
      const applyTarget = projectConfig.targets['apply'];

      expect(applyTarget.executor).toBe('nx:run-commands');
      expect(applyTarget.defaultConfiguration).toBe('dev');
      expect(applyTarget.configurations.dev.command).toContain(
        'terraform apply',
      );
      expect(applyTarget.configurations.dev.command).toContain('dev.tfplan');
      expect(applyTarget.options.cwd).toBe('{projectRoot}/src');
      expect(applyTarget.dependsOn).toEqual(['plan']);
    });

    it('should configure deploy target as alias for apply', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );
      const deployTarget = projectConfig.targets['deploy'];

      expect(deployTarget.dependsOn).toEqual(['apply']);
    });

    it('should configure bootstrap target correctly', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );
      const bootstrapTarget = projectConfig.targets['bootstrap'];

      expect(bootstrapTarget.executor).toBe('nx:run-commands');
      expect(bootstrapTarget.options.commands).toEqual([
        'tsx {projectRoot}/scripts/bootstrap.ts {projectRoot}',
      ]);
      expect(bootstrapTarget.options.cwd).toBe('{workspaceRoot}');
    });

    it('should import an existing state bucket when its state object is missing', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      const bootstrapScript = tree.read(
        'packages/my-terraform-project/scripts/bootstrap.ts',
        'utf-8',
      );

      // Without the import, a surviving bucket whose state object was lost
      // wedges bootstrap on a permanent BucketAlreadyOwnedByYou.
      expect(bootstrapScript).toContain('HeadBucketCommand');
      expect(bootstrapScript).toContain("'import'");
      expect(bootstrapScript).toContain("'aws_s3_bucket.terraform_state'");
      expect(bootstrapScript).toMatch(/!haveState\s*&&/);
    });

    it('should configure plan target correctly', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );
      const planTarget = projectConfig.targets['plan'];

      expect(planTarget.executor).toBe('nx:run-commands');
      expect(planTarget.defaultConfiguration).toBe('dev');
      expect(planTarget.configurations.dev.commands[0]).toContain('make-dir');
      expect(planTarget.configurations.dev.commands[1]).toContain(
        'terraform plan',
      );
      expect(planTarget.configurations.dev.commands[1]).toContain(
        '-var-file=env/dev.tfvars',
      );
      expect(planTarget.dependsOn).toEqual([
        'init',
        'validate',
        '^validate',
        'build',
      ]);
    });

    it('should configure init target correctly', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );
      const initTarget = projectConfig.targets['init'];

      expect(initTarget.executor).toBe('nx:run-commands');
      expect(initTarget.defaultConfiguration).toBe('dev');
      expect(initTarget.options.commands).toEqual([
        'tsx {projectRoot}/scripts/init.ts {projectRoot}',
      ]);
      expect(initTarget.options.cwd).toBe('{workspaceRoot}');
      expect(initTarget.configurations.dev.env.TF_ENV).toBe('dev');
      expect(initTarget.dependsOn).toEqual(['^init']);
    });

    it('should configure destroy target correctly', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );
      const destroyTarget = projectConfig.targets['destroy'];

      expect(destroyTarget.executor).toBe('nx:run-commands');
      expect(destroyTarget.defaultConfiguration).toBe('dev');
      expect(destroyTarget.configurations.dev.command).toBe(
        'terraform destroy -var-file=env/dev.tfvars',
      );
      expect(destroyTarget.dependsOn).toEqual(['init']);
    });
  });

  describe('library type', () => {
    const librarySchema: TerraformProjectGeneratorSchema = {
      name: 'my-terraform-project',
      type: 'library',
      directory: 'packages',
    };

    it('should generate terraform library project with correct configuration', async () => {
      await terraformProjectGenerator(tree, librarySchema);

      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );

      expect(projectConfig).toBeDefined();
      expect(projectConfig.root).toBe('packages/my-terraform-project');
      expect(projectConfig.projectType).toBe('library');
      expect(projectConfig.sourceRoot).toBe(
        'packages/my-terraform-project/src',
      );

      // Verify only library targets are present (no application targets)
      expect(projectConfig.targets).toHaveProperty('checkov');
      expect(projectConfig.targets).toHaveProperty('fmt');
      expect(projectConfig.targets).toHaveProperty('init');
      expect(projectConfig.targets).toHaveProperty('test');
      expect(projectConfig.targets).toHaveProperty('validate');

      // Verify application targets are NOT present
      expect(projectConfig.targets).not.toHaveProperty('apply');
      expect(projectConfig.targets).not.toHaveProperty('bootstrap');
      expect(projectConfig.targets).not.toHaveProperty('bootstrap-destroy');
      expect(projectConfig.targets).not.toHaveProperty('deploy');
      expect(projectConfig.targets).not.toHaveProperty('destroy');
      expect(projectConfig.targets).not.toHaveProperty('plan');
      expect(projectConfig.targets).not.toHaveProperty('output');
    });

    it('should configure library targets correctly', async () => {
      await terraformProjectGenerator(tree, librarySchema);

      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );

      // Test fmt target
      const fmtTarget = projectConfig.targets['fmt'];
      expect(fmtTarget.executor).toBe('nx:run-commands');
      expect(fmtTarget.cache).toBe(true);
      expect(fmtTarget.options.command).toBe('terraform fmt');
      expect(fmtTarget.options.cwd).toBe('{projectRoot}/src');

      // Test validate target
      const validateTarget = projectConfig.targets['validate'];
      expect(validateTarget.executor).toBe('nx:run-commands');
      expect(validateTarget.cache).toBe(true);
      expect(validateTarget.options.command).toBe('terraform validate');
      expect(validateTarget.options.cwd).toBe('{projectRoot}/src');
      expect(validateTarget.dependsOn).toEqual(['init']);

      // Test checkov target, which carries the scan
      const checkovTarget = projectConfig.targets['checkov'];
      expect(checkovTarget.executor).toBe('nx:run-commands');
      expect(checkovTarget.cache).toBe(true);
      expect(checkovTarget.options.command).toContain('uvx --from checkov==');

      // `test` is an alias of it
      expect(projectConfig.targets['test'].dependsOn).toEqual(['checkov']);
    });
  });

  describe('nx configuration', () => {
    const schema: TerraformProjectGeneratorSchema = {
      name: 'my-terraform-project',
      type: 'application',
    };

    it('should add terraform plugin to nx.json when not present', async () => {
      // Setup nx.json without terraform plugin
      tree.write(
        'nx.json',
        JSON.stringify({
          plugins: ['@nx/js'],
        }),
      );

      await terraformProjectGenerator(tree, schema);

      const nxJson = readNxJson(tree);
      expect(nxJson.plugins).toContain('@nx-extend/terraform');
      expect(nxJson.plugins).toContain('@nx/js');
    });

    it('should not duplicate terraform plugin in nx.json when already present', async () => {
      // Setup nx.json with terraform plugin already present
      tree.write(
        'nx.json',
        JSON.stringify({
          plugins: ['@nx/js', '@nx-extend/terraform'],
        }),
      );

      await terraformProjectGenerator(tree, schema);

      const nxJson = readNxJson(tree);
      const terraformPlugins = nxJson.plugins.filter((p) =>
        typeof p === 'string'
          ? p === '@nx-extend/terraform'
          : p.plugin === '@nx-extend/terraform',
      );
      expect(terraformPlugins).toHaveLength(1);
    });

    it('should handle nx.json with object-style plugin configuration', async () => {
      // Setup nx.json with object-style plugin
      tree.write(
        'nx.json',
        JSON.stringify({
          plugins: [
            { plugin: '@nx/js', options: {} },
            { plugin: '@nx-extend/terraform', options: {} },
          ],
        }),
      );

      await terraformProjectGenerator(tree, schema);

      const nxJson = readNxJson(tree);
      const terraformPlugins = nxJson.plugins.filter((p) =>
        typeof p === 'string'
          ? p === '@nx-extend/terraform'
          : p.plugin === '@nx-extend/terraform',
      );
      expect(terraformPlugins).toHaveLength(1);
    });

    it('should initialize plugins array when nx.json has no plugins', async () => {
      // Setup nx.json without plugins
      tree.write('nx.json', JSON.stringify({}));

      await terraformProjectGenerator(tree, schema);

      const nxJson = readNxJson(tree);
      expect(nxJson.plugins).toContain('@nx-extend/terraform');
    });
  });

  describe('file generation', () => {
    const schema: TerraformProjectGeneratorSchema = {
      name: 'my-terraform-project',
      type: 'application',
    };

    it('should generate files for application type', async () => {
      await terraformProjectGenerator(tree, schema);

      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );
      expect(projectConfig).toBeDefined();
      expect(projectConfig.projectType).toBe('application');
    });

    it('should generate files for library type', async () => {
      const librarySchema: TerraformProjectGeneratorSchema = {
        name: 'my-terraform-project',
        type: 'library',
      };

      await terraformProjectGenerator(tree, librarySchema);

      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );
      expect(projectConfig).toBeDefined();
      expect(projectConfig.projectType).toBe('library');
    });
  });

  describe('dependencies', () => {
    const schema: TerraformProjectGeneratorSchema = {
      name: 'my-terraform-project',
      type: 'application',
    };

    it('should return install packages callback', async () => {
      const callback = await terraformProjectGenerator(tree, schema);

      expect(typeof callback).toBe('function');
    });
  });

  describe('git configuration', () => {
    const schema: TerraformProjectGeneratorSchema = {
      name: 'my-terraform-project',
      type: 'application',
    };

    it('should update gitignore with terraform patterns', async () => {
      await terraformProjectGenerator(tree, schema);

      expect(tree.read('.gitignore').toString()).toContain('.terraform');
    });
  });

  describe('generator metadata', () => {
    const schema: TerraformProjectGeneratorSchema = {
      name: 'my-terraform-project',
      type: 'application',
    };

    it('should export generator info constant', () => {
      expect(TERRAFORM_PROJECT_GENERATOR_INFO).toBeDefined();
      expect(typeof TERRAFORM_PROJECT_GENERATOR_INFO).toBe('object');
    });
  });

  describe('target configuration sorting', () => {
    const schema: TerraformProjectGeneratorSchema = {
      name: 'my-terraform-project',
      type: 'application',
    };

    it('should sort target keys alphabetically', async () => {
      await terraformProjectGenerator(tree, schema);

      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );
      const targetKeys = Object.keys(projectConfig.targets);
      const sortedKeys = [...targetKeys].sort();

      expect(targetKeys).toEqual(sortedKeys);
    });
  });

  describe('path calculations', () => {
    const schema: TerraformProjectGeneratorSchema = {
      name: 'my-terraform-project',
      type: 'application',
      directory: 'packages',
    };

    it('should calculate correct dist paths for terraform and checkov outputs', async () => {
      await terraformProjectGenerator(tree, schema);

      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );

      // Check that plan target uses correct dist path
      const planCommand =
        projectConfig.targets['plan'].configurations.dev.commands[1];
      expect(planCommand).toContain('dist/{projectRoot}/terraform/dev.tfplan');

      // Check that apply target uses correct dist path
      const applyCommand =
        projectConfig.targets['apply'].configurations.dev.command;
      expect(applyCommand).toContain('dist/{projectRoot}/terraform/dev.tfplan');

      // Check that checkov target uses correct checkov output path
      const checkovCommand = projectConfig.targets['checkov'].options.command;
      expect(checkovCommand).toContain('dist/{projectRoot}/checkov');
    });
  });

  it('should place project in subDirectory when provided', async () => {
    await terraformProjectGenerator(tree, {
      name: 'my-terraform-project',
      type: 'application',
      directory: 'packages',
      subDirectory: 'infra',
    });
    expect(tree.exists('packages/infra')).toBeTruthy();
    expect(tree.exists('packages/infra/src')).toBeTruthy();
    expect(tree.exists('packages/infra/src/main.tf')).toBeTruthy();
  });

  describe('idempotency', () => {
    const applicationSchema: TerraformProjectGeneratorSchema = {
      name: 'my-terraform-project',
      type: 'application',
      directory: 'packages',
    };

    it('should be idempotent when re-run with same options', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      const projectCountAfterFirstRun = getProjects(tree).size;
      const mainTfAfterFirstRun = tree.read(
        'packages/my-terraform-project/src/main.tf',
        'utf-8',
      );

      await expect(
        terraformProjectGenerator(tree, applicationSchema),
      ).resolves.toBeDefined();

      expect(getProjects(tree).size).toBe(projectCountAfterFirstRun);
      expect(
        tree.read('packages/my-terraform-project/src/main.tf', 'utf-8'),
      ).toEqual(mainTfAfterFirstRun);
    });

    it('should preserve project.json customisations when re-run', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      const config = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );
      config.targets = {
        ...config.targets,
        custom: { executor: 'nx:noop' },
      };
      updateProjectConfiguration(tree, '@proj/my-terraform-project', config);

      await terraformProjectGenerator(tree, applicationSchema);

      expect(
        readProjectConfiguration(tree, '@proj/my-terraform-project').targets
          ?.custom,
      ).toEqual({ executor: 'nx:noop' });
    });

    it('should create an independent project when run with a different name', async () => {
      await terraformProjectGenerator(tree, applicationSchema);
      await terraformProjectGenerator(tree, {
        ...applicationSchema,
        name: 'other-terraform-project',
      });

      expect(
        readProjectConfiguration(tree, '@proj/my-terraform-project'),
      ).toBeDefined();
      expect(
        readProjectConfiguration(tree, '@proj/other-terraform-project'),
      ).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle missing getTsLibDetails gracefully', async () => {
      vi.spyOn(tsLibGenerator, 'getTsLibDetails').mockImplementation(() => {
        throw new Error('Failed to get lib details');
      });

      const schema: TerraformProjectGeneratorSchema = {
        name: 'my-terraform-project',
        type: 'application',
      };

      await expect(terraformProjectGenerator(tree, schema)).rejects.toThrow(
        'Failed to get lib details',
      );
    });
  });
});
