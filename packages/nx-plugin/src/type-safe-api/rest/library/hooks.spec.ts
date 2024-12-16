/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { Tree } from '@nx/devkit';
import { typeScriptRestHooksLibraryGenerator } from './hooks';
import { InferredTypeSafeRestApiSchema } from '../schema';
import { join } from 'path';

describe('type-safe-api rest typescript hooks library generator', () => {
  let tree: Tree;
  let options: InferredTypeSafeRestApiSchema;

  beforeEach(() => {
    tree = createTreeWithEmptyWorkspace();
    options = {
      name: 'test-api',
      modelLanguage: 'openapi',
      infrastructureLanguage: 'typescript',
      handlerLanguages: ['typescript'],
      libraries: ['typescript-react-hooks'],
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
        dir: 'apis/test-api-library',
        typescriptHooks: {
          dir: 'apis/test-api-library/typescript-hooks',
          fullyQualifiedName: 'test-api-library-typescript-hooks'
        }
      }
    };
  });

  it('should configure project.json with appropriate targets', async () => {
    await typeScriptRestHooksLibraryGenerator(tree, options);

    const projectConfig = JSON.parse(
      tree.read('apis/test-api-library/typescript-hooks/project.json', 'utf-8')
    );

    // Check metadata
    expect(projectConfig.metadata.apiName).toBe('test-api');

    // Check generate target configuration
    expect(projectConfig.targets.generate).toBeDefined();
    expect(projectConfig.targets.generate.executor).toBe('nx:run-commands');
    expect(projectConfig.targets.generate.options.commands[0]).toContain('type-safe-api generate');
    expect(projectConfig.targets.generate.options.commands[0]).toContain('--specPath "apis/test-api-model/dist/spec.json"');
    expect(projectConfig.targets.generate.options.commands[0]).toContain('--outputPath "apis/test-api-library/typescript-hooks"');
    expect(projectConfig.targets.generate.options.commands[0]).toContain('--templateDirs "typescript/templates/client" "typescript-react-query-hooks"');
    expect(projectConfig.targets.generate.options.commands[0]).toContain("--excludeTemplates '**/README.md.ejs'");

    // Check compile target dependencies
    expect(projectConfig.targets.compile.dependsOn).toContain('generate');

    // Snapshot full project.json
    expect(projectConfig).toMatchSnapshot();
  });

  it('should add implicit dependency on model project', async () => {
    await typeScriptRestHooksLibraryGenerator(tree, options);

    const projectConfig = JSON.parse(
      tree.read('apis/test-api-library/typescript-hooks/project.json', 'utf-8')
    );

    expect(projectConfig.implicitDependencies).toContain('test-api-model');
  });

  it('should update tsconfig.lib.json with react-jsx', async () => {
    await typeScriptRestHooksLibraryGenerator(tree, options);

    const tsConfig = JSON.parse(
      tree.read('apis/test-api-library/typescript-hooks/tsconfig.lib.json', 'utf-8')
    );

    expect(tsConfig.jsx).toBe('react-jsx');
  });

  it('should add required dependencies to package.json', async () => {
    await typeScriptRestHooksLibraryGenerator(tree, options);

    const packageJson = JSON.parse(tree.read('package.json', 'utf-8'));

    // Check dependencies are added
    expect(packageJson.dependencies['@tanstack/react-query']).toBeDefined();
    expect(packageJson.dependencies['react']).toBeDefined();
    expect(packageJson.dependencies['@types/react']).toBeDefined();
  });
});
