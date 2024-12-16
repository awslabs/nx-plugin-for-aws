/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import { typeSpecRestModelGenerator } from './typespec';
import { join } from 'path';
import { InferredTypeSafeRestApiSchema } from '../schema';

describe('type-safe-api rest typespec model generator', () => {
  let tree: Tree;
  let options: InferredTypeSafeRestApiSchema;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    options = {
      name: 'test-api',
      modelLanguage: 'typespec',
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

  it('should create and configure project.json', async () => {
    await typeSpecRestModelGenerator(tree, options);

    // Check project.json was created
    expect(tree.exists('apis/test-api-model/project.json')).toBeTruthy();

    // Verify project.json contents
    const projectConfig = JSON.parse(
      tree.read('apis/test-api-model/project.json', 'utf-8')
    );

    // Check metadata
    expect(projectConfig.metadata.apiName).toBe('test-api');

    // Check build target configuration
    expect(projectConfig.targets.build).toBeDefined();
    expect(projectConfig.targets.build.executor).toBe('nx:run-commands');
    expect(projectConfig.targets.build.options.commands[0]).toContain('tsp compile');
    expect(projectConfig.targets.build.options.commands[0]).toContain(join('apis/test-api-model', 'src'));
    expect(projectConfig.targets.build.options.commands[0]).toContain('tspconfig.yaml');
    expect(projectConfig.targets.build.options.commands[1]).toContain('type-safe-api parse-openapi-spec');
    expect(projectConfig.targets.build.options.commands[1]).toContain(options.model.outputSpecPath);

    // Snapshot full project.json
    expect(projectConfig).toMatchSnapshot('project.json');
  });

  it('should add required dependencies to package.json', async () => {
    await typeSpecRestModelGenerator(tree, options);

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));

    // Check TypeSpec dependencies were added
    expect(packageJson.devDependencies['@typespec/compiler']).toBeDefined();
    expect(packageJson.devDependencies['@typespec/http']).toBeDefined();
    expect(packageJson.devDependencies['@typespec/openapi']).toBeDefined();
    expect(packageJson.devDependencies['@typespec/openapi3']).toBeDefined();
  });

  it('should generate model files', async () => {
    await typeSpecRestModelGenerator(tree, options);

    // Check template files were generated
    expect(tree.exists('apis/test-api-model/tspconfig.yaml')).toBeTruthy();
    expect(tree.exists('apis/test-api-model/src/main.tsp')).toBeTruthy();

    // Snapshot generated files
    expect(tree.read('apis/test-api-model/tspconfig.yaml', 'utf-8')).toMatchSnapshot(
      'tspconfig.yaml'
    );
    expect(tree.read('apis/test-api-model/src/main.tsp', 'utf-8')).toMatchSnapshot(
      'main.tsp'
    );
    expect(tree.read('apis/test-api-model/src/types/errors.tsp', 'utf-8')).toMatchSnapshot(
      'errors.tsp'
    );
    expect(tree.read('apis/test-api-model/src/decorators/handler.tsp', 'utf-8')).toMatchSnapshot(
      'handler.tsp'
    );
    expect(tree.read('apis/test-api-model/src/decorators/handler.js', 'utf-8')).toMatchSnapshot(
      'handler.js'
    );
  });
});
