/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import { typeScriptRestInfrastructureGenerator } from './typescript';
import { InferredTypeSafeRestApiSchema } from '../schema';

describe('type-safe-api rest typescript infrastructure generator', () => {
  let tree: Tree;
  let options: InferredTypeSafeRestApiSchema;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    options = {
      name: 'test-api',
      modelLanguage: 'openapi',
      infrastructureLanguage: 'typescript',
      handlerLanguages: ['typescript'],
      libraries: [],
      runtimeLanguages: ['typescript'],
      fullyQualifiedApiName: 'test-api',
      nameKebabCase: 'test-api',
      namePascalCase: 'TestApi',
      dir: 'apis/test-api',
      model: {
        dir: 'apis/test-api-model',
        fullyQualifiedName: 'test-api-model',
        outputSpecPath: 'apis/test-api-model/dist/spec.json'
      },
      runtime: {
        dir: 'apis/test-api-runtime',
        typescript: {
          dir: 'apis/test-api-runtime/typescript',
          fullyQualifiedName: 'test-api-runtime-typescript'
        }
      },
      infrastructure: {
        dir: 'apis/test-api-infrastructure',
        typescript: {
          dir: 'apis/test-api-infrastructure/typescript',
          fullyQualifiedName: 'test-api-infrastructure-typescript'
        }
      },
      handlers: {
        dir: 'apis/test-api-handlers',
        typescript: {
          dir: 'apis/test-api-handlers/typescript',
          fullyQualifiedName: 'test-api-handlers-typescript',
          assetPath: 'apis/test-api-handlers/typescript/dist'
        }
      },
      library: {
        dir: 'apis/test-api-library'
      }
    };
  });

  it('should configure project.json with appropriate targets', async () => {
    await typeScriptRestInfrastructureGenerator(tree, options);

    const projectConfig = JSON.parse(
      tree.read('apis/test-api-infrastructure/typescript/project.json', 'utf-8')
    );

    // Check metadata
    expect(projectConfig.metadata.apiName).toBe('test-api');

    // Check generate target configuration
    expect(projectConfig.targets.generate).toBeDefined();
    expect(projectConfig.targets.generate.executor).toBe('nx:run-commands');
    expect(projectConfig.targets.generate.options.commands[0]).toContain('type-safe-api generate');
    expect(projectConfig.targets.generate.options.commands[0]).toContain('--specPath "apis/test-api-model/dist/spec.json"');
    expect(projectConfig.targets.generate.options.commands[0]).toContain('--outputPath "apis/test-api-infrastructure/typescript"');
    expect(projectConfig.targets.generate.options.commands[0]).toContain('--templateDirs "typescript-cdk-infrastructure"');

    // Check mocks target configuration
    expect(projectConfig.targets.mocks).toBeDefined();
    expect(projectConfig.targets.mocks.executor).toBe('nx:run-commands');
    expect(projectConfig.targets.mocks.options.commands[0]).toContain('type-safe-api generate-mock-data');
    expect(projectConfig.targets.mocks.dependsOn[0].projects).toContain('test-api-model');

    // Check compile and build target dependencies
    expect(projectConfig.targets.compile.dependsOn).toContain('generate');
    expect(projectConfig.targets.build.dependsOn).toContain('mocks');

    // Snapshot full project.json
    expect(projectConfig).toMatchSnapshot();
  });

  it('should add implicit dependency on model project', async () => {
    await typeScriptRestInfrastructureGenerator(tree, options);

    const projectConfig = JSON.parse(
      tree.read('apis/test-api-infrastructure/typescript/project.json', 'utf-8')
    );

    expect(projectConfig.implicitDependencies).toContain('test-api-model');
  });

  it('should add implicit dependency on runtime project', async () => {
    await typeScriptRestInfrastructureGenerator(tree, options);

    const projectConfig = JSON.parse(
      tree.read('apis/test-api-infrastructure/typescript/project.json', 'utf-8')
    );

    expect(projectConfig.implicitDependencies).toContain('test-api-runtime-typescript');
  });

  it('should add required dependencies to package.json', async () => {
    await typeScriptRestInfrastructureGenerator(tree, options);

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));

    // Check dependencies are added
    expect(packageJson.dependencies['@aws/pdk']).toBeDefined();
    expect(packageJson.dependencies['aws-cdk-lib']).toBeDefined();
    expect(packageJson.dependencies['constructs']).toBeDefined();
  });

  it('should add required entries to .gitignore', async () => {
    await typeScriptRestInfrastructureGenerator(tree, options);

    const gitignore = tree.read('apis/test-api-infrastructure/typescript/.gitignore', 'utf-8');
    expect(gitignore).toContain('mocks');
    expect(gitignore).toContain('src');
    expect(gitignore).toContain('.tsapi-manifest');
  });
});
