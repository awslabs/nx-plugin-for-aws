/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import { typeScriptRestHandlersGenerator } from './typescript';
import { InferredTypeSafeRestApiSchema } from '../schema';
import { join } from 'path';

describe('type-safe-api rest typescript handlers generator', () => {
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
    await typeScriptRestHandlersGenerator(tree, options);

    const projectConfig = JSON.parse(
      tree.read('apis/test-api-handlers/typescript/project.json', 'utf-8')
    );

    // Check metadata
    expect(projectConfig.metadata.apiName).toBe('test-api');

    // Check generate target configuration
    expect(projectConfig.targets.generate).toBeDefined();
    expect(projectConfig.targets.generate.executor).toBe('nx:run-commands');
    expect(projectConfig.targets.generate.options.commands[0]).toContain('type-safe-api generate');
    expect(projectConfig.targets.generate.options.commands[0]).toContain('--specPath "apis/test-api-model/dist/spec.json"');
    expect(projectConfig.targets.generate.options.commands[0]).toContain('--outputPath "apis/test-api-handlers/typescript"');
    expect(projectConfig.targets.generate.options.commands[0]).toContain('--templateDirs "typescript-lambda-handlers"');

    // Check compile and test target dependencies
    expect(projectConfig.targets.compile.dependsOn).toContain('generate');
    expect(projectConfig.targets.test.dependsOn).toContain('generate');

    // Check bundle target configuration
    expect(projectConfig.targets.bundle).toBeDefined();
    expect(projectConfig.targets.bundle.executor).toBe('nx:run-commands');
    expect(projectConfig.targets.bundle.options.commands).toHaveLength(3);
    expect(projectConfig.targets.bundle.options.commands[0]).toContain('rm -rf');
    expect(projectConfig.targets.bundle.options.commands[1]).toContain('esbuild');
    expect(projectConfig.targets.bundle.options.commands[2]).toContain('for f in');
    expect(projectConfig.targets.bundle.dependsOn).toContain('compile');

    // Check build target dependencies
    expect(projectConfig.targets.build.dependsOn).toContain('bundle');

    // Snapshot full project.json
    expect(projectConfig).toMatchSnapshot();
  });

  it('should configure TypeScript lib with vitest and eslint', async () => {
    await typeScriptRestHandlersGenerator(tree, options);

    const projectConfig = JSON.parse(
      tree.read('apis/test-api-handlers/typescript/project.json', 'utf-8')
    );

    // Verify TypeScript lib configuration
    expect(projectConfig.targets.test.executor).toBe('@nx/vite:test');
    expect(projectConfig.targets.lint.executor).toBe('@nx/eslint:lint');
  });

  it('should add required entries to .gitignore', async () => {
    await typeScriptRestHandlersGenerator(tree, options);

    const gitignore = tree.read('apis/test-api-handlers/typescript/.gitignore', 'utf-8');
    expect(gitignore).toContain('.tsapi-manifest');
  });
});
