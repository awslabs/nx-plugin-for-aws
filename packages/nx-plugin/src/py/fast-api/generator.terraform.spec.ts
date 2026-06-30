/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Tree } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { pyFastApiProjectGenerator } from './generator';

describe('fastapi project generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('terraform iac', () => {
    it('should generate terraform files for HTTP API with IAM auth and snapshot them', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
        directory: 'apps',
        infra: 'http-lambda',
        auth: 'iam',
        iac: 'terraform',
      });

      // Find all terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      // Verify terraform files are created
      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the specific terraform files
      const coreApiFile = terraformFiles.find((f) => f.includes('http-api'));
      const appApiFile = terraformFiles.find((f) => f.includes('test-api'));

      expect(coreApiFile).toBeDefined();
      expect(appApiFile).toBeDefined();

      // Read terraform file contents
      const coreApiContent = tree.read(coreApiFile!, 'utf-8');
      const appApiContent = tree.read(appApiFile!, 'utf-8');

      // Verify IAM auth configuration
      expect(appApiContent).toContain('authorization_type = "AWS_IAM"');
      expect(appApiContent).not.toContain('variable "user_pool_id"');

      // Verify FastAPI-specific handler configuration (Lambda Web Adapter)
      expect(appApiContent).toMatch(/handler\s+=\s+"run\.sh"/);
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.14"/);

      // Snapshot terraform files
      const terraformFileContents = {
        'http-api.tf': coreApiContent,
        'test-api.tf': appApiContent,
      };

      expect(terraformFileContents).toMatchSnapshot('terraform-http-iam-files');
    });

    it('should generate terraform files for HTTP API with Cognito auth and snapshot them', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
        directory: 'apps',
        infra: 'http-lambda',
        auth: 'cognito',
        iac: 'terraform',
      });

      // Find all terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      // Verify terraform files are created
      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the specific terraform files
      const coreApiFile = terraformFiles.find((f) => f.includes('http-api'));
      const appApiFile = terraformFiles.find((f) => f.includes('test-api'));

      expect(coreApiFile).toBeDefined();
      expect(appApiFile).toBeDefined();

      // Read terraform file contents
      const coreApiContent = tree.read(coreApiFile!, 'utf-8');
      const appApiContent = tree.read(appApiFile!, 'utf-8');

      // Verify Cognito auth configuration
      expect(appApiContent).toContain('variable "user_pool_id"');
      expect(appApiContent).toContain('variable "user_pool_client_ids"');
      expect(appApiContent).toContain('authorization_type = "JWT"');

      // Verify FastAPI-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"run\.sh"/);
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.14"/);

      // Snapshot terraform files
      const terraformFileContents = {
        'http-api.tf': coreApiContent,
        'test-api.tf': appApiContent,
      };

      expect(terraformFileContents).toMatchSnapshot(
        'terraform-http-cognito-files',
      );
    });

    it('should generate terraform files for HTTP API with Custom auth and snapshot them', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
        directory: 'apps',
        infra: 'http-lambda',
        auth: 'custom',
        iac: 'terraform',
      });

      // Find all terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      // Verify terraform files are created
      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the specific terraform files
      const coreApiFile = terraformFiles.find((f) => f.includes('http-api'));
      const appApiFile = terraformFiles.find((f) => f.includes('test-api'));

      expect(coreApiFile).toBeDefined();
      expect(appApiFile).toBeDefined();

      // Read terraform file contents
      const coreApiContent = tree.read(coreApiFile!, 'utf-8');
      const appApiContent = tree.read(appApiFile!, 'utf-8');

      // Verify Custom auth configuration
      expect(appApiContent).toContain('authorization_type = "CUSTOM"');
      expect(appApiContent).not.toContain('variable "user_pool_id"');

      // Verify FastAPI-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"run\.sh"/);
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.14"/);

      // Snapshot terraform files
      const terraformFileContents = {
        'http-api.tf': coreApiContent,
        'test-api.tf': appApiContent,
      };

      expect(terraformFileContents).toMatchSnapshot(
        'terraform-http-custom-files',
      );
    });

    it('should generate terraform files for REST API with IAM auth and snapshot them', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
        directory: 'apps',
        infra: 'rest-lambda',
        auth: 'iam',
        iac: 'terraform',
      });

      // Find all terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      // Verify terraform files are created
      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the specific terraform files
      const coreApiFile = terraformFiles.find((f) => f.includes('rest-api'));
      const appApiFile = terraformFiles.find((f) => f.includes('test-api'));

      expect(coreApiFile).toBeDefined();
      expect(appApiFile).toBeDefined();

      // Read terraform file contents
      const coreApiContent = tree.read(coreApiFile!, 'utf-8');
      const appApiContent = tree.read(appApiFile!, 'utf-8');

      // Verify IAM auth configuration
      expect(appApiContent).toContain('authorization = "AWS_IAM"');
      expect(appApiContent).not.toContain('variable "user_pool_id"');

      // Verify FastAPI-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"run\.sh"/);
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.14"/);

      // Snapshot terraform files
      const terraformFileContents = {
        'rest-api.tf': coreApiContent,
        'test-api.tf': appApiContent,
      };

      expect(terraformFileContents).toMatchSnapshot('terraform-rest-iam-files');
    });

    it('should generate terraform files for REST API with Cognito auth and snapshot them', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
        directory: 'apps',
        infra: 'rest-lambda',
        auth: 'cognito',
        iac: 'terraform',
      });

      // Find all terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      // Verify terraform files are created
      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the specific terraform files
      const coreApiFile = terraformFiles.find((f) => f.includes('rest-api'));
      const appApiFile = terraformFiles.find((f) => f.includes('test-api'));

      expect(coreApiFile).toBeDefined();
      expect(appApiFile).toBeDefined();

      // Read terraform file contents
      const coreApiContent = tree.read(coreApiFile!, 'utf-8');
      const appApiContent = tree.read(appApiFile!, 'utf-8');

      // Verify Cognito auth configuration
      expect(appApiContent).toContain('variable "user_pool_id"');
      expect(appApiContent).toContain('variable "user_pool_client_ids"');
      expect(appApiContent).toContain('authorization = "COGNITO_USER_POOLS"');

      // Verify FastAPI-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"run\.sh"/);
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.14"/);

      // Snapshot terraform files
      const terraformFileContents = {
        'rest-api.tf': coreApiContent,
        'test-api.tf': appApiContent,
      };

      expect(terraformFileContents).toMatchSnapshot(
        'terraform-rest-cognito-files',
      );
    });

    it('should generate terraform files for REST API with None auth and snapshot them', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
        directory: 'apps',
        infra: 'rest-lambda',
        auth: 'custom',
        iac: 'terraform',
      });

      // Find all terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      // Verify terraform files are created
      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the specific terraform files
      const coreApiFile = terraformFiles.find((f) => f.includes('rest-api'));
      const appApiFile = terraformFiles.find((f) => f.includes('test-api'));

      expect(coreApiFile).toBeDefined();
      expect(appApiFile).toBeDefined();

      // Read terraform file contents
      const coreApiContent = tree.read(coreApiFile!, 'utf-8');
      const appApiContent = tree.read(appApiFile!, 'utf-8');

      // Verify None auth configuration
      expect(appApiContent).toContain('authorization = "NONE"');
      expect(appApiContent).not.toContain('variable "user_pool_id"');

      // Verify FastAPI-specific handler configuration
      expect(appApiContent).toMatch(/handler\s+=\s+"run\.sh"/);
      expect(appApiContent).toMatch(/runtime\s+=\s+"python3\.14"/);

      // Snapshot terraform files
      const terraformFileContents = {
        'rest-api.tf': coreApiContent,
        'test-api.tf': appApiContent,
      };

      expect(terraformFileContents).toMatchSnapshot(
        'terraform-rest-none-files',
      );
    });

    it('should configure project targets and dependencies correctly for terraform', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
        directory: 'apps',
        infra: 'http-lambda',
        auth: 'iam',
        iac: 'terraform',
      });

      // Check that shared terraform project has build dependency on the API project
      const sharedTerraformConfig = JSON.parse(
        tree.read('packages/common/terraform/project.json', 'utf-8'),
      );

      expect(sharedTerraformConfig.targets.build.dependsOn).toContain(
        'proj.test_api:build',
      );

      // Verify that CDK-specific metadata generation targets are NOT added for terraform
      expect(
        sharedTerraformConfig.targets['generate:test-api-metadata'],
      ).not.toBeDefined();

      const projectConfig = JSON.parse(
        tree.read('apps/test_api/project.json', 'utf-8'),
      );

      // Should still have basic FastAPI targets
      expect(projectConfig.targets['bundle-x86']).toBeDefined();
      expect(projectConfig.targets.openapi).toBeDefined();
      expect(projectConfig.targets.serve).toBeDefined();
      expect(projectConfig.targets.build.dependsOn).toContain('bundle');
      expect(projectConfig.targets.build.dependsOn).toContain('openapi');
    });

    it('should not create CDK constructs when using terraform', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
        directory: 'apps',
        infra: 'http-lambda',
        auth: 'iam',
        iac: 'terraform',
      });

      // Verify CDK files are NOT created
      expect(
        tree.exists('packages/common/constructs/src/app/apis/test-api.ts'),
      ).toBeFalsy();
      expect(
        tree.exists('packages/common/constructs/src/core/api/http-api.ts'),
      ).toBeFalsy();
    });

    it('should throw error for invalid iac', async () => {
      await expect(
        pyFastApiProjectGenerator(tree, {
          name: 'test-api',
          directory: 'apps',
          infra: 'http-lambda',
          auth: 'iam',
          iac: 'InvalidProvider' as any,
        }),
      ).rejects.toThrow('Unsupported iac InvalidProvider');
    });

    it('should generate correct FastAPI handler configuration with custom module name', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'test-api',
        directory: 'apps',
        infra: 'http-lambda',
        auth: 'iam',
        iac: 'terraform',
        moduleName: 'custom_module',
      });

      // Find the actual terraform app file
      const allFiles = tree.listChanges().map((f) => f.path);
      const appApiFile = allFiles.find(
        (f) =>
          f.includes('terraform') &&
          f.includes('test-api') &&
          f.endsWith('.tf'),
      );

      expect(appApiFile).toBeDefined();

      const terraformFile = tree.read(appApiFile!, 'utf-8');

      // Verify FastAPI-specific handler configuration with custom module
      expect(terraformFile).toMatch(/handler\s+=\s+"run\.sh"/);
      expect(terraformFile).toMatch(/runtime\s+=\s+"python3\.14"/);
    });

    it('should handle terraform with different directory structures', async () => {
      await pyFastApiProjectGenerator(tree, {
        name: 'nested-api',
        directory: 'apps/nested/path',
        infra: 'rest-lambda',
        auth: 'cognito',
        iac: 'terraform',
      });

      // Verify terraform files are created
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the app-specific terraform file
      const appApiFile = terraformFiles.find((f) => f.includes('nested-api'));
      expect(appApiFile).toBeDefined();

      const terraformContent = tree.read(appApiFile!, 'utf-8');

      // Verify the correct bundle path is used for nested directories
      expect(terraformContent).toContain(
        'dist/apps/nested/path/nested_api/bundle',
      );
      expect(terraformContent).toContain(
        'authorization = "COGNITO_USER_POOLS"',
      );
    });
  });
});
