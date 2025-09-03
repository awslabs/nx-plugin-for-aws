/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree, readProjectConfiguration, readNxJson } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import {
  terraformProjectGenerator,
  TERRAFORM_PROJECT_GENERATOR_INFO,
} from './generator';
import { TerraformProjectGeneratorSchema } from './schema';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as tsLibGenerator from '../../ts/lib/generator';
import * as gitUtils from '../../utils/git';

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
      expect(projectConfig.targets).toHaveProperty('destroy');
      expect(projectConfig.targets).toHaveProperty('init');
      expect(projectConfig.targets).toHaveProperty('plan');

      // Verify library targets are also present
      expect(projectConfig.targets).toHaveProperty('fmt');
      expect(projectConfig.targets).toHaveProperty('test');
      expect(projectConfig.targets).toHaveProperty('validate');
      expect(projectConfig.targets).toHaveProperty('output');
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

    it('should configure bootstrap target correctly', async () => {
      await terraformProjectGenerator(tree, applicationSchema);

      const projectConfig = readProjectConfiguration(
        tree,
        '@proj/my-terraform-project',
      );
      const bootstrapTarget = projectConfig.targets['bootstrap'];

      expect(bootstrapTarget.executor).toBe('nx:run-commands');
      expect(bootstrapTarget.options.commands).toHaveLength(4);
      expect(bootstrapTarget.options.commands[1]).toBe('terraform init');
      expect(bootstrapTarget.options.parallel).toBe(false);
      expect(bootstrapTarget.options.cwd).toBe('{projectRoot}/bootstrap');
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
      expect(initTarget.configurations.dev.command).toContain(
        'terraform init -reconfigure',
      );
      expect(initTarget.configurations.dev.command).toContain(
        '-backend-config',
      );
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
      expect(projectConfig.targets).toHaveProperty('fmt');
      expect(projectConfig.targets).toHaveProperty('init');
      expect(projectConfig.targets).toHaveProperty('test');
      expect(projectConfig.targets).toHaveProperty('validate');

      // Verify application targets are NOT present
      expect(projectConfig.targets).not.toHaveProperty('apply');
      expect(projectConfig.targets).not.toHaveProperty('bootstrap');
      expect(projectConfig.targets).not.toHaveProperty('bootstrap-destroy');
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

      // Test test target
      const testTarget = projectConfig.targets['test'];
      expect(testTarget.executor).toBe('nx:run-commands');
      expect(testTarget.cache).toBe(true);
      expect(testTarget.options.command).toContain('uvx checkov==');
      expect(testTarget.dependsOn).toEqual(['validate']);
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
      expect(planCommand).toContain(
        'dist/packages/my-terraform-project/terraform/dev.tfplan',
      );

      // Check that apply target uses correct dist path
      const applyCommand =
        projectConfig.targets['apply'].configurations.dev.command;
      expect(applyCommand).toContain(
        'dist/packages/my-terraform-project/terraform/dev.tfplan',
      );

      // Check that test target uses correct checkov output path
      const testCommand = projectConfig.targets['test'].options.command;
      expect(testCommand).toContain(
        'dist/packages/my-terraform-project/checkov',
      );
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
