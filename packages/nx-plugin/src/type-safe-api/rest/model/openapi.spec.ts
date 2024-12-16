/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import { openApiRestModelGenerator } from './openapi';
import { join } from 'path';
import { InferredTypeSafeRestApiSchema } from '../schema';

describe('type-safe-api rest openapi model generator', () => {
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

  it('should create and configure project.json', async () => {
    await openApiRestModelGenerator(tree, options);

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
    expect(projectConfig.targets.build.options.commands[0]).toContain('type-safe-api parse-openapi-spec');
    expect(projectConfig.targets.build.options.commands[0]).toContain(join('apis/test-api-model', 'src', 'main.yaml'));
    expect(projectConfig.targets.build.options.commands[0]).toContain(options.model.outputSpecPath);

    // Snapshot full project.json
    expect(projectConfig).toMatchSnapshot('project.json');
  });

  it('should generate OpenAPI model files', async () => {
    await openApiRestModelGenerator(tree, options);

    // Check template files were generated
    expect(tree.exists('apis/test-api-model/src/main.yaml')).toBeTruthy();
    expect(tree.read('apis/test-api-model/src/main.yaml', 'utf-8')).toMatchSnapshot(
      'main.yaml'
    );
  });
});
