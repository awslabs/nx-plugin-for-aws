/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  readJson,
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTreeUsingTsSolutionSetup } from '../../utils/test';
import smithyProjectGenerator from '../project/generator';
import { TS_SMITHY_API_GENERATOR_INFO } from '../ts/api/generator';
import { smithyModelConnectionGenerator } from './generator';

describe('smithy#model-connection generator', () => {
  let tree: Tree;

  const addShapeLibrary = async (name: string) => {
    await smithyProjectGenerator(tree, {
      name,
      type: 'shapes',
      directory: 'packages',
      preferInstallDependencies: false,
    });
  };

  const addServiceModel = async (name: string) => {
    await smithyProjectGenerator(tree, {
      name,
      type: 'service',
      directory: 'packages',
      preferInstallDependencies: false,
    });
  };

  /**
   * Set up a model project which belongs to a ts#smithy-api, along with the
   * backend project which the user would normally name
   */
  const addApi = async (name: string) => {
    await addServiceModel(`${name}-model`);

    const modelConfig = readProjectConfiguration(tree, `@proj/${name}-model`);
    updateProjectConfiguration(tree, modelConfig.name, {
      ...modelConfig,
      metadata: {
        ...modelConfig.metadata,
        backendProject: `@proj/${name}`,
      } as never,
    });

    tree.write(
      `packages/${name}/project.json`,
      JSON.stringify({
        name: `@proj/${name}`,
        root: `packages/${name}`,
        metadata: {
          generator: TS_SMITHY_API_GENERATOR_INFO.id,
          modelProject: `@proj/${name}-model`,
        },
        targets: { compile: {} },
      }),
    );
  };

  const copyCommands = (projectName: string): string[] =>
    readProjectConfiguration(tree, projectName).targets['copy-model-deps']
      .options.commands;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should copy the shape library sources into the consuming model', async () => {
    await addServiceModel('my-model');
    await addShapeLibrary('my-shapes');

    await smithyModelConnectionGenerator(tree, {
      sourceProject: '@proj/my-model',
      targetProject: '@proj/my-shapes',
      preferInstallDependencies: false,
    });

    expect(copyCommands('@proj/my-model')).toEqual([
      'rimraf {projectRoot}/.smithy-deps',
      'make-dir {projectRoot}/.smithy-deps',
      'ncp packages/my-shapes/src {projectRoot}/.smithy-deps/my-shapes',
    ]);
  });

  it('should build the shape library before copying its sources', async () => {
    await addServiceModel('my-model');
    await addShapeLibrary('my-shapes');

    await smithyModelConnectionGenerator(tree, {
      sourceProject: '@proj/my-model',
      targetProject: '@proj/my-shapes',
      preferInstallDependencies: false,
    });

    const modelConfig = readProjectConfiguration(tree, '@proj/my-model');
    expect(modelConfig.targets['copy-model-deps'].dependsOn).toEqual([
      '@proj/my-shapes:build',
    ]);
    // The copied shapes must be in place before the model is built
    expect(modelConfig.targets.compile.dependsOn).toContain('copy-model-deps');
  });

  it('should configure the docker build and smithy-build to load the shapes', async () => {
    await addServiceModel('my-model');
    await addShapeLibrary('my-shapes');

    await smithyModelConnectionGenerator(tree, {
      sourceProject: '@proj/my-model',
      targetProject: '@proj/my-shapes',
      preferInstallDependencies: false,
    });

    // The Docker build context is the project directory, so dependencies must
    // be copied into the image alongside the project's own sources
    const dockerfile = tree.read('packages/my-model/build.Dockerfile', 'utf-8');
    expect(dockerfile).toContain(
      'COPY src src\nCOPY .smithy-deps .smithy-deps',
    );

    const smithyBuild = readJson(tree, 'packages/my-model/smithy-build.json');
    expect(smithyBuild.sources).toEqual(['src/', '.smithy-deps/']);
  });

  it('should gitignore the copied shapes', async () => {
    await addServiceModel('my-model');
    await addShapeLibrary('my-shapes');

    await smithyModelConnectionGenerator(tree, {
      sourceProject: '@proj/my-model',
      targetProject: '@proj/my-shapes',
      preferInstallDependencies: false,
    });

    expect(tree.read('packages/my-model/.gitignore', 'utf-8')).toContain(
      '.smithy-deps/',
    );
  });

  it('should record the dependency in metadata', async () => {
    await addServiceModel('my-model');
    await addShapeLibrary('my-shapes');

    await smithyModelConnectionGenerator(tree, {
      sourceProject: '@proj/my-model',
      targetProject: '@proj/my-shapes',
      preferInstallDependencies: false,
    });

    expect(
      (readProjectConfiguration(tree, '@proj/my-model').metadata as any)
        .smithyDependencies,
    ).toEqual(['@proj/my-shapes']);
  });

  it('should connect an api by resolving it to its model project', async () => {
    await addApi('my-api');
    await addShapeLibrary('my-shapes');

    await smithyModelConnectionGenerator(tree, {
      sourceProject: '@proj/my-api',
      targetProject: '@proj/my-shapes',
      preferInstallDependencies: false,
    });

    // The model consumes the shapes, not the backend
    expect(copyCommands('@proj/my-api-model')).toContain(
      'ncp packages/my-shapes/src {projectRoot}/.smithy-deps/my-shapes',
    );
    expect(
      readProjectConfiguration(tree, '@proj/my-api').targets['copy-model-deps'],
    ).toBeUndefined();
  });

  it('should pull in shapes reached transitively', async () => {
    await addServiceModel('my-model');
    await addShapeLibrary('shapes-a');
    await addShapeLibrary('shapes-b');

    // shapes-a depends on shapes-b
    await smithyModelConnectionGenerator(tree, {
      sourceProject: '@proj/shapes-a',
      targetProject: '@proj/shapes-b',
      preferInstallDependencies: false,
    });

    await smithyModelConnectionGenerator(tree, {
      sourceProject: '@proj/my-model',
      targetProject: '@proj/shapes-a',
      preferInstallDependencies: false,
    });

    expect(
      (readProjectConfiguration(tree, '@proj/my-model').metadata as any)
        .smithyDependencies,
    ).toEqual(['@proj/shapes-a', '@proj/shapes-b']);
    expect(copyCommands('@proj/my-model')).toEqual([
      'rimraf {projectRoot}/.smithy-deps',
      'make-dir {projectRoot}/.smithy-deps',
      'ncp packages/shapes-a/src {projectRoot}/.smithy-deps/shapes-a',
      'ncp packages/shapes-b/src {projectRoot}/.smithy-deps/shapes-b',
    ]);
  });

  it('should copy a shape library reached by two paths only once', async () => {
    await addServiceModel('my-model');
    await addShapeLibrary('shapes-a');
    await addShapeLibrary('shapes-b');
    await addShapeLibrary('shapes-common');

    // Both shapes-a and shapes-b depend on shapes-common
    for (const library of ['@proj/shapes-a', '@proj/shapes-b']) {
      await smithyModelConnectionGenerator(tree, {
        sourceProject: library,
        targetProject: '@proj/shapes-common',
        preferInstallDependencies: false,
      });
    }

    await smithyModelConnectionGenerator(tree, {
      sourceProject: '@proj/my-model',
      targetProject: '@proj/shapes-a',
      preferInstallDependencies: false,
    });
    await smithyModelConnectionGenerator(tree, {
      sourceProject: '@proj/my-model',
      targetProject: '@proj/shapes-b',
      preferInstallDependencies: false,
    });

    // Defining shapes-common's shapes twice would fail the smithy build
    const commonCopies = copyCommands('@proj/my-model').filter((command) =>
      command.includes('shapes-common'),
    );
    expect(commonCopies).toHaveLength(1);
    expect(
      (readProjectConfiguration(tree, '@proj/my-model').metadata as any)
        .smithyDependencies,
    ).toEqual(['@proj/shapes-a', '@proj/shapes-b', '@proj/shapes-common']);
  });

  it('should be additive when connecting a second shape library', async () => {
    await addServiceModel('my-model');
    await addShapeLibrary('shapes-a');
    await addShapeLibrary('shapes-b');

    await smithyModelConnectionGenerator(tree, {
      sourceProject: '@proj/my-model',
      targetProject: '@proj/shapes-a',
      preferInstallDependencies: false,
    });
    await smithyModelConnectionGenerator(tree, {
      sourceProject: '@proj/my-model',
      targetProject: '@proj/shapes-b',
      preferInstallDependencies: false,
    });

    const commands = copyCommands('@proj/my-model');
    expect(commands).toContain(
      'ncp packages/shapes-a/src {projectRoot}/.smithy-deps/shapes-a',
    );
    expect(commands).toContain(
      'ncp packages/shapes-b/src {projectRoot}/.smithy-deps/shapes-b',
    );
  });

  it('should be idempotent when re-run with same options', async () => {
    await addServiceModel('my-model');
    await addShapeLibrary('my-shapes');

    await smithyModelConnectionGenerator(tree, {
      sourceProject: '@proj/my-model',
      targetProject: '@proj/my-shapes',
      preferInstallDependencies: false,
    });

    const projectJsonAfterFirstRun = tree.read(
      'packages/my-model/project.json',
      'utf-8',
    );
    const dockerfileAfterFirstRun = tree.read(
      'packages/my-model/build.Dockerfile',
      'utf-8',
    );
    const smithyBuildAfterFirstRun = tree.read(
      'packages/my-model/smithy-build.json',
      'utf-8',
    );
    const gitIgnoreAfterFirstRun = tree.read(
      'packages/my-model/.gitignore',
      'utf-8',
    );

    await smithyModelConnectionGenerator(tree, {
      sourceProject: '@proj/my-model',
      targetProject: '@proj/my-shapes',
      preferInstallDependencies: false,
    });

    expect(tree.read('packages/my-model/project.json', 'utf-8')).toEqual(
      projectJsonAfterFirstRun,
    );
    expect(tree.read('packages/my-model/build.Dockerfile', 'utf-8')).toEqual(
      dockerfileAfterFirstRun,
    );
    expect(tree.read('packages/my-model/smithy-build.json', 'utf-8')).toEqual(
      smithyBuildAfterFirstRun,
    );
    expect(tree.read('packages/my-model/.gitignore', 'utf-8')).toEqual(
      gitIgnoreAfterFirstRun,
    );
  });

  it('should reject connecting a project to itself', async () => {
    await addShapeLibrary('my-shapes');

    await expect(
      smithyModelConnectionGenerator(tree, {
        sourceProject: '@proj/my-shapes',
        targetProject: '@proj/my-shapes',
        preferInstallDependencies: false,
      }),
    ).rejects.toThrow(/itself/);
  });

  it('should reject a circular dependency', async () => {
    await addShapeLibrary('shapes-a');
    await addShapeLibrary('shapes-b');

    await smithyModelConnectionGenerator(tree, {
      sourceProject: '@proj/shapes-a',
      targetProject: '@proj/shapes-b',
      preferInstallDependencies: false,
    });

    await expect(
      smithyModelConnectionGenerator(tree, {
        sourceProject: '@proj/shapes-b',
        targetProject: '@proj/shapes-a',
        preferInstallDependencies: false,
      }),
    ).rejects.toThrow(/circular/);
  });

  it('should reject a target which is not a smithy project', async () => {
    await addServiceModel('my-model');
    tree.write(
      'packages/other/project.json',
      JSON.stringify({ name: '@proj/other', root: 'packages/other' }),
    );

    await expect(
      smithyModelConnectionGenerator(tree, {
        sourceProject: '@proj/my-model',
        targetProject: '@proj/other',
        preferInstallDependencies: false,
      }),
    ).rejects.toThrow(/Unsupported connection target/);
  });

  it("should reject a target which is an api's model project", async () => {
    await addServiceModel('my-model');
    await addApi('my-api');

    await expect(
      smithyModelConnectionGenerator(tree, {
        sourceProject: '@proj/my-model',
        targetProject: '@proj/my-api-model',
        preferInstallDependencies: false,
      }),
    ).rejects.toThrow(/model for the API/);
  });
});
