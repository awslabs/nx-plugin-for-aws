/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import { typeScriptRestRuntimeGenerator } from './typescript';
import { InferredTypeSafeRestApiSchema } from '../schema';

describe('type-safe-api rest typescript runtime generator', () => {
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
    await typeScriptRestRuntimeGenerator(tree, options);

    // Verify project.json contents
    const projectConfig = JSON.parse(
      tree.read('apis/test-api-runtime/typescript/project.json', 'utf-8')
    );

    // Check metadata
    expect(projectConfig.metadata.apiName).toBe('test-api');

    // Check generate target configuration
    expect(projectConfig.targets.generate).toBeDefined();
    expect(projectConfig.targets.generate.executor).toBe('nx:run-commands');
    expect(projectConfig.targets.generate.options.commands[0]).toContain('type-safe-api generate');
    expect(projectConfig.targets.generate.options.commands[0]).toContain('--specPath "apis/test-api-model/dist/spec.json"');
    expect(projectConfig.targets.generate.options.commands[0]).toContain('--outputPath "apis/test-api-runtime/typescript"');
    expect(projectConfig.targets.generate.options.commands[0]).toContain('--templateDirs "typescript"');

    // Check compile target dependencies
    expect(projectConfig.targets.compile.dependsOn).toContain('generate');

    // Snapshot full project.json
    expect(projectConfig).toMatchSnapshot();
  });

  it('should add implicit dependency on model project', async () => {
    await typeScriptRestRuntimeGenerator(tree, options);

    const projectConfig = JSON.parse(
      tree.read('apis/test-api-runtime/typescript/project.json', 'utf-8')
    );

    expect(projectConfig.implicitDependencies).toContain('test-api-model');
  });

  it('should add required dependencies to package.json', async () => {
    await typeScriptRestRuntimeGenerator(tree, options);

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));

    // Check dependencies are added
    expect(packageJson.devDependencies['@types/aws-lambda']).toBeDefined();
    expect(packageJson.dependencies['@aws-lambda-powertools/tracer']).toBeDefined();
    expect(packageJson.dependencies['@aws-lambda-powertools/logger']).toBeDefined();
    expect(packageJson.dependencies['@aws-lambda-powertools/metrics']).toBeDefined();
  });

  it('should add required entries to .gitignore', async () => {
    await typeScriptRestRuntimeGenerator(tree, options);

    const gitignore = tree.read('apis/test-api-runtime/typescript/.gitignore', 'utf-8');
    expect(gitignore).toContain('src');
    expect(gitignore).toContain('.tsapi-manifest');
  });
});
