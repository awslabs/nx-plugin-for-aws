/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { addProjectConfiguration, Tree } from '@nx/devkit';
import {
  tsLambdaFunctionGenerator,
  TS_LAMBDA_FUNCTION_GENERATOR_INFO,
} from './generator';
import { EventSource, TsLambdaFunctionGeneratorSchema } from './schema';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import { expectHasMetricTags } from '../../utils/metrics.spec';
import { TS_HANDLER_RETURN_TYPES } from './io';
import { TypeScriptVerifier } from '../../utils/test/ts.spec';
import {
  ensureAwsNxPluginConfig,
  updateAwsNxPluginConfig,
} from '../../utils/config/utils';

describe('ts-lambda-function generator', () => {
  let tree: Tree;
  const options: TsLambdaFunctionGeneratorSchema = {
    project: 'test-project',
    functionName: 'TestFunction',
    eventSource: 'EventBridgeSchema',
    iacProvider: 'CDK',
  };
  const verifier = new TypeScriptVerifier([
    '@aws-lambda-powertools/parser',
    '@aws-lambda-powertools/metrics',
    '@aws-lambda-powertools/tracer',
    '@aws-lambda-powertools/logger',
    'zod',
    '@types/aws-lambda',
    '@middy/core',
  ]);

  const validateTypeScript = (paths: string[]) => {
    verifier.expectTypeScriptToCompile(tree, paths);
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();

    // Add a test TypeScript project
    addProjectConfiguration(tree, 'test-project', {
      name: 'test-project',
      root: 'packages/test-project',
      sourceRoot: 'packages/test-project/src',
      targets: {
        compile: {
          executor: '@nx/js:tsc',
        },
      },
    });

    // Create tsconfig.json for the project
    tree.write('packages/test-project/tsconfig.json', '{}');

    // Create source directory
    tree.write('packages/test-project/src/index.ts', 'export {};');
  });

  it('should run successfully', async () => {
    await tsLambdaFunctionGenerator(tree, options);
    expect(
      tree.exists('packages/test-project/src/test-function.ts'),
    ).toBeTruthy();
  });

  it('should create lambda function file with EventBridge schema', async () => {
    await tsLambdaFunctionGenerator(tree, options);

    const lambdaFile = tree.read(
      'packages/test-project/src/test-function.ts',
      'utf-8',
    );
    expect(lambdaFile).toBeDefined();
    expect(lambdaFile).toMatchSnapshot('lambda-handler-eventbridge.ts');
  });

  it('should create lambda function file with Any event source', async () => {
    const anyOptions = { ...options, eventSource: 'Any' as const };
    await tsLambdaFunctionGenerator(tree, anyOptions);

    const lambdaFile = tree.read(
      'packages/test-project/src/test-function.ts',
      'utf-8',
    );
    expect(lambdaFile).toBeDefined();
    expect(lambdaFile).toMatchSnapshot('lambda-handler-any.ts');
  });

  it('should create lambda function file with SQS schema', async () => {
    const sqsOptions = { ...options, eventSource: 'SqsSchema' as const };
    await tsLambdaFunctionGenerator(tree, sqsOptions);

    const lambdaFile = tree.read(
      'packages/test-project/src/test-function.ts',
      'utf-8',
    );
    expect(lambdaFile).toBeDefined();
    expect(lambdaFile).toMatchSnapshot('lambda-handler-sqs.ts');
  });

  it('should add correct bundle target with esbuild command', async () => {
    await tsLambdaFunctionGenerator(tree, options);

    const projectJson = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );

    // Check bundle-test-function target
    expect(projectJson.targets['bundle-test-function']).toBeDefined();
    const bundleTarget = projectJson.targets['bundle-test-function'];

    expect(bundleTarget.cache).toBe(true);
    expect(bundleTarget.executor).toBe('nx:run-commands');
    expect(bundleTarget.outputs).toEqual([
      '{workspaceRoot}/dist/packages/test-project/bundle-test-function',
    ]);
    expect(bundleTarget.options.parallel).toBe(false);
    expect(bundleTarget.dependsOn).toEqual(['compile']);

    // Check the esbuild command
    expect(bundleTarget.options.commands).toHaveLength(1);
    expect(bundleTarget.options.commands[0]).toBe(
      'esbuild packages/test-project/src/test-function.ts --bundle --platform=node --target=node22 --format=cjs --outfile=dist/packages/test-project/bundle-test-function/index.js --external:@aws-sdk/*',
    );
  });

  it('should create bundle target when it does not exist', async () => {
    await tsLambdaFunctionGenerator(tree, options);

    const projectJson = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );

    // Check bundle target
    expect(projectJson.targets['bundle']).toBeDefined();
    const bundleTarget = projectJson.targets['bundle'];

    expect(bundleTarget.cache).toBe(true);
    expect(bundleTarget.dependsOn).toEqual(['bundle-test-function']);
  });

  it('should update existing bundle target', async () => {
    // Add existing bundle target
    const projectConfig = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    projectConfig.targets.bundle = {
      cache: true,
      executor: 'nx:run-commands',
      outputs: ['{workspaceRoot}/dist/packages/test-project/bundle'],
      options: { commands: [], parallel: false },
      dependsOn: ['existing-bundle-target'],
    };
    tree.write(
      'packages/test-project/project.json',
      JSON.stringify(projectConfig),
    );

    await tsLambdaFunctionGenerator(tree, options);

    const updatedProjectJson = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    const bundleTarget = updatedProjectJson.targets['bundle'];

    expect(bundleTarget.dependsOn).toEqual([
      'existing-bundle-target',
      'bundle-test-function',
    ]);
  });

  it('should update build target to depend on bundle', async () => {
    // Add existing build target
    const projectConfig = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    projectConfig.targets.build = {
      executor: '@nx/js:tsc',
      dependsOn: ['other-target'],
    };
    tree.write(
      'packages/test-project/project.json',
      JSON.stringify(projectConfig),
    );

    await tsLambdaFunctionGenerator(tree, options);

    const updatedProjectJson = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    const buildTarget = updatedProjectJson.targets['build'];

    expect(buildTarget.dependsOn).toEqual(['other-target', 'bundle']);
  });

  it('should add required dependencies to root package.json', async () => {
    await tsLambdaFunctionGenerator(tree, options);

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));

    // Check dependencies were added to root package.json
    expect(
      packageJson.dependencies['@aws-lambda-powertools/tracer'],
    ).toBeDefined();
    expect(
      packageJson.dependencies['@aws-lambda-powertools/logger'],
    ).toBeDefined();
    expect(
      packageJson.dependencies['@aws-lambda-powertools/metrics'],
    ).toBeDefined();
    expect(
      packageJson.dependencies['@aws-lambda-powertools/parser'],
    ).toBeDefined();
    expect(packageJson.dependencies['@middy/core']).toBeDefined();

    // Check dev dependencies
    expect(packageJson.devDependencies['esbuild']).toBeDefined();
  });

  it('should handle function path', async () => {
    const pathOptions = { ...options, functionPath: 'lambda-functions' };
    await tsLambdaFunctionGenerator(tree, pathOptions);

    expect(
      tree.exists(
        'packages/test-project/src/lambda-functions/test-function.ts',
      ),
    ).toBeTruthy();

    // Check that the bundle command uses the correct path
    const projectJson = JSON.parse(
      tree.read('packages/test-project/project.json', 'utf-8'),
    );
    const bundleCommand =
      projectJson.targets['bundle-test-function'].options.commands[0];
    expect(bundleCommand).toContain(
      'packages/test-project/src/lambda-functions/test-function.ts',
    );
  });

  it('should create CDK construct', async () => {
    await tsLambdaFunctionGenerator(tree, options);

    const constructPath =
      'packages/common/constructs/src/app/lambda-functions/test-project-test-function.ts';
    expect(tree.exists(constructPath)).toBeTruthy();

    const constructFile = tree.read(constructPath, 'utf-8');
    expect(constructFile).toMatchSnapshot('cdk-construct.ts');
  });

  it('should add exports to shared constructs index files', async () => {
    await tsLambdaFunctionGenerator(tree, options);

    // Check app index.ts
    const appIndex = tree.read(
      'packages/common/constructs/src/app/index.ts',
      'utf-8',
    );
    expect(appIndex).toContain("export * from './lambda-functions/index.js';");

    // Check lambda-functions index.ts
    const lambdaIndex = tree.read(
      'packages/common/constructs/src/app/lambda-functions/index.ts',
      'utf-8',
    );
    expect(lambdaIndex).toContain(
      "export * from './test-project-test-function.js';",
    );
  });

  it('should update shared constructs project.json', async () => {
    await tsLambdaFunctionGenerator(tree, options);

    const sharedConstructsProjectJson = JSON.parse(
      tree.read('packages/common/constructs/project.json', 'utf-8'),
    );

    expect(sharedConstructsProjectJson.targets.build.dependsOn).toContain(
      'test-project:build',
    );
  });

  it('should throw error if lambda function already exists', async () => {
    // Create the lambda function file first
    tree.write(
      'packages/test-project/src/test-function.ts',
      '// existing file',
    );

    await expect(tsLambdaFunctionGenerator(tree, options)).rejects.toThrow(
      'This project already has a lambda function with the name test-function',
    );
  });

  it('should throw error if project has no tsconfig.json', async () => {
    // Remove tsconfig.json
    tree.delete('packages/test-project/tsconfig.json');

    await expect(tsLambdaFunctionGenerator(tree, options)).rejects.toThrow(
      'This generator does not support selected project test-project. The project must be a typescript project (ie contain a tsconfig.json)',
    );
  });

  it('should throw error if project has no source root', async () => {
    // Create a new project without sourceRoot
    addProjectConfiguration(tree, 'no-source-root-project', {
      name: 'no-source-root-project',
      root: 'packages/no-source-root-project',
      targets: {
        compile: {
          executor: '@nx/js:tsc',
        },
      },
    });

    tree.write('packages/no-source-root-project/tsconfig.json', '{}');

    const noSourceRootOptions = {
      ...options,
      project: 'no-source-root-project',
    };

    await expect(
      tsLambdaFunctionGenerator(tree, noSourceRootOptions),
    ).rejects.toThrow(
      'This project does not have a source root. Please add a source root to the project configuration before running this generator.',
    );
  });

  it('should handle scoped project names correctly', async () => {
    // Add a scoped project
    addProjectConfiguration(tree, '@myorg/scoped-project', {
      name: '@myorg/scoped-project',
      root: 'packages/scoped-project',
      sourceRoot: 'packages/scoped-project/src',
      targets: {
        compile: {
          executor: '@nx/js:tsc',
        },
      },
    });

    tree.write('packages/scoped-project/tsconfig.json', '{}');

    const scopedOptions = { ...options, project: '@myorg/scoped-project' };
    await tsLambdaFunctionGenerator(tree, scopedOptions);

    // Check that the lambda function was created
    expect(
      tree.exists('packages/scoped-project/src/test-function.ts'),
    ).toBeTruthy();

    // Check that construct name uses only the project name without scope
    const constructPath =
      'packages/common/constructs/src/app/lambda-functions/scoped-project-test-function.ts';
    expect(tree.exists(constructPath)).toBeTruthy();

    // Also check the bundle target name
    const projectJson = JSON.parse(
      tree.read('packages/scoped-project/project.json', 'utf-8'),
    );
    expect(projectJson.targets['bundle-test-function']).toBeDefined();
  });

  it('should add generator metrics', async () => {
    await tsLambdaFunctionGenerator(tree, options);

    expectHasMetricTags(tree, TS_LAMBDA_FUNCTION_GENERATOR_INFO.metric);
  });

  it('should handle complex function names with special characters', async () => {
    const complexOptions = {
      ...options,
      functionName: 'My Complex Function Name!',
      functionPath: 'nested/path',
    };

    await tsLambdaFunctionGenerator(tree, complexOptions);

    // Should normalize the function name
    expect(
      tree.exists(
        'packages/test-project/src/nested/path/my-complex-function-name.ts',
      ),
    ).toBeTruthy();

    // Check construct name
    const constructPath =
      'packages/common/constructs/src/app/lambda-functions/test-project-my-complex-function-name.ts';
    expect(tree.exists(constructPath)).toBeTruthy();
  });

  it.each(Object.keys(TS_HANDLER_RETURN_TYPES))(
    'should generate a lambda function which compiles with eventSource %s',
    async (eventSource: EventSource) => {
      await tsLambdaFunctionGenerator(tree, {
        ...options,
        eventSource,
      });

      validateTypeScript(['packages/test-project/src/test-function.ts']);
    },
  );

  describe('terraform iacProvider', () => {
    it('should generate terraform files for lambda function and snapshot them', async () => {
      const terraformOptions = {
        ...options,
        iacProvider: 'Terraform' as const,
      };
      await tsLambdaFunctionGenerator(tree, terraformOptions);

      // Find all terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      // Verify terraform files are created
      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the specific terraform file for the lambda function
      const lambdaFunctionTerraformFile = terraformFiles.find((f) =>
        f.includes('test-project-test-function'),
      );

      expect(lambdaFunctionTerraformFile).toBeDefined();

      // Read terraform file content
      const terraformContent = tree.read(lambdaFunctionTerraformFile!, 'utf-8');

      // Verify lambda function configuration
      expect(terraformContent).toMatch(/handler\s+=\s+"index\.handler"/);
      expect(terraformContent).toMatch(/runtime\s+=\s+"nodejs22\.x"/);
      expect(terraformContent).toContain('test-project-test-function');

      // Snapshot terraform file
      const terraformFileContents = {
        'test-project-test-function.tf': terraformContent,
      };

      expect(terraformFileContents).toMatchSnapshot('terraform-lambda-files');
    });

    it('should generate terraform files with custom function path', async () => {
      const terraformOptions = {
        ...options,
        iacProvider: 'Terraform' as const,
        functionPath: 'lambda-functions',
      };
      await tsLambdaFunctionGenerator(tree, terraformOptions);

      // Find terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      expect(terraformFiles.length).toBeGreaterThan(0);

      const lambdaFunctionTerraformFile = terraformFiles.find((f) =>
        f.includes('test-project-test-function'),
      );

      expect(lambdaFunctionTerraformFile).toBeDefined();

      const terraformContent = tree.read(lambdaFunctionTerraformFile!, 'utf-8');

      // Verify the correct bundle path is used for custom function path
      expect(terraformContent).toContain(
        'dist/packages/test-project/bundle-test-function',
      );
    });

    it('should generate terraform files with different event sources', async () => {
      const sqsTerraformOptions = {
        ...options,
        iacProvider: 'Terraform' as const,
        eventSource: 'SqsSchema' as const,
      };
      await tsLambdaFunctionGenerator(tree, sqsTerraformOptions);

      // Find terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      expect(terraformFiles.length).toBeGreaterThan(0);

      const lambdaFunctionTerraformFile = terraformFiles.find((f) =>
        f.includes('test-project-test-function'),
      );

      expect(lambdaFunctionTerraformFile).toBeDefined();

      const terraformContent = tree.read(lambdaFunctionTerraformFile!, 'utf-8');

      // Verify lambda function configuration is still correct regardless of event source
      expect(terraformContent).toMatch(/handler\s+=\s+"index\.handler"/);
      expect(terraformContent).toMatch(/runtime\s+=\s+"nodejs22\.x"/);
    });

    it('should configure project targets and dependencies correctly for terraform', async () => {
      const terraformOptions = {
        ...options,
        iacProvider: 'Terraform' as const,
      };
      await tsLambdaFunctionGenerator(tree, terraformOptions);

      // Check that shared terraform project has build dependency on the lambda function project
      const sharedTerraformConfig = JSON.parse(
        tree.read('packages/common/terraform/project.json', 'utf-8'),
      );

      expect(sharedTerraformConfig.targets.build.dependsOn).toContain(
        'test-project:build',
      );

      // Verify project configuration still has basic targets
      const projectConfig = JSON.parse(
        tree.read('packages/test-project/project.json', 'utf-8'),
      );

      // Should still have bundle and build targets
      expect(projectConfig.targets.build).toBeDefined();
      expect(projectConfig.targets['bundle-test-function']).toBeDefined();
      expect(projectConfig.targets.bundle).toBeDefined();
    });

    it('should not create CDK constructs when using terraform', async () => {
      const terraformOptions = {
        ...options,
        iacProvider: 'Terraform' as const,
      };
      await tsLambdaFunctionGenerator(tree, terraformOptions);

      // Verify CDK files are NOT created
      expect(tree.exists('packages/common/constructs')).toBeFalsy();
    });

    it('should throw error for invalid iacProvider', async () => {
      await expect(
        tsLambdaFunctionGenerator(tree, {
          ...options,
          iacProvider: 'InvalidProvider' as any,
        }),
      ).rejects.toThrow('Unsupported iacProvider InvalidProvider');
    });

    it('should handle terraform with scoped project names', async () => {
      // Add a scoped project
      addProjectConfiguration(tree, '@myorg/scoped-project', {
        name: '@myorg/scoped-project',
        root: 'packages/scoped-project',
        sourceRoot: 'packages/scoped-project/src',
        targets: {
          compile: {
            executor: '@nx/js:tsc',
          },
        },
      });

      tree.write('packages/scoped-project/tsconfig.json', '{}');

      const scopedTerraformOptions = {
        ...options,
        project: '@myorg/scoped-project',
        iacProvider: 'Terraform' as const,
      };
      await tsLambdaFunctionGenerator(tree, scopedTerraformOptions);

      // Verify terraform files are created
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the lambda function terraform file
      const lambdaFunctionTerraformFile = terraformFiles.find((f) =>
        f.includes('scoped-project-test-function'),
      );
      expect(lambdaFunctionTerraformFile).toBeDefined();

      const terraformContent = tree.read(lambdaFunctionTerraformFile!, 'utf-8');

      // Verify the correct bundle path is used for scoped projects
      expect(terraformContent).toContain(
        'dist/packages/scoped-project/bundle-test-function',
      );
    });

    it('should handle terraform with complex function names', async () => {
      const complexTerraformOptions = {
        ...options,
        functionName: 'My Complex Function Name!',
        functionPath: 'nested/path',
        iacProvider: 'Terraform' as const,
      };

      await tsLambdaFunctionGenerator(tree, complexTerraformOptions);

      // Verify terraform files are created
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      expect(terraformFiles.length).toBeGreaterThan(0);

      // Find the lambda function terraform file with normalized name
      const lambdaFunctionTerraformFile = terraformFiles.find((f) =>
        f.includes('test-project-my-complex-function-name'),
      );
      expect(lambdaFunctionTerraformFile).toBeDefined();

      const terraformContent = tree.read(lambdaFunctionTerraformFile!, 'utf-8');

      // Verify the correct bundle path is used for complex function names
      expect(terraformContent).toContain(
        'dist/packages/test-project/bundle-my-complex-function-name',
      );
    });

    it('should match snapshot for terraform generated files with different configurations', async () => {
      const terraformOptions = {
        ...options,
        functionName: 'SnapshotFunction',
        eventSource: 'Any' as const,
        iacProvider: 'Terraform' as const,
      };
      await tsLambdaFunctionGenerator(tree, terraformOptions);

      // Find terraform files
      const allFiles = tree.listChanges().map((f) => f.path);
      const terraformFiles = allFiles.filter(
        (f) => f.includes('terraform') && f.endsWith('.tf'),
      );

      const lambdaFunctionTerraformFile = terraformFiles.find((f) =>
        f.includes('test-project-snapshot-function'),
      );

      expect(lambdaFunctionTerraformFile).toBeDefined();

      // Snapshot the generated terraform file
      const terraformContent = tree.read(lambdaFunctionTerraformFile!, 'utf-8');

      expect(terraformContent).toMatchSnapshot(
        'terraform-lambda-snapshot-function.tf',
      );
    });

    it('should inherit iacProvider from config when set to Inherit', async () => {
      // Set up config with CDK provider using utility methods
      await ensureAwsNxPluginConfig(tree);
      await updateAwsNxPluginConfig(tree, {
        iac: {
          provider: 'CDK',
        },
      });

      await tsLambdaFunctionGenerator(tree, {
        ...options,
        iacProvider: 'Inherit',
      });

      // Verify CDK constructs are created (not terraform)
      expect(tree.exists('packages/common/constructs')).toBeTruthy();
      expect(tree.exists('packages/common/terraform')).toBeFalsy();
      expect(
        tree.exists(
          'packages/common/constructs/src/app/lambda-functions/test-project-test-function.ts',
        ),
      ).toBeTruthy();
    });
  });
});
