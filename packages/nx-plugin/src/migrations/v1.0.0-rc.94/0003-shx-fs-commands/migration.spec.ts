/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readJson,
  readProjectConfiguration,
  type Tree,
  writeJson,
} from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const addTarget = (
  tree: Tree,
  projectName: string,
  targetName: string,
  commands: unknown[],
) =>
  addProjectConfiguration(tree, projectName, {
    root: `packages/${projectName}`,
    targets: {
      [targetName]: {
        executor: 'nx:run-commands',
        options: { commands, parallel: false },
      },
    },
  });

const optionsOf = (tree: Tree, projectName: string, targetName: string) =>
  readProjectConfiguration(tree, projectName).targets?.[targetName]?.options;

const commandsOf = (tree: Tree, projectName: string, targetName: string) =>
  optionsOf(tree, projectName, targetName)?.commands;

describe('shx-fs-commands migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    writeJson(tree, 'package.json', {
      name: 'root',
      devDependencies: {
        ncp: '2.0.0',
        rimraf: '6.1.3',
        'make-dir-cli': '4.0.0',
        'cpy-cli': '7.0.0',
      },
    });
  });

  it('should rewrite rimraf and make-dir', async () => {
    addTarget(tree, 'lib', 'package', [
      'rimraf dist/packages/lib/package',
      'make-dir dist/packages/lib/package',
    ]);

    await migration(tree);

    expect(commandsOf(tree, 'lib', 'package')).toEqual([
      'shx rm -rf dist/packages/lib/package',
      'shx mkdir -p dist/packages/lib/package',
    ]);
  });

  it('should rewrite a file copy without -R', async () => {
    addTarget(tree, 'lib', 'package', [
      'ncp dist/packages/lib/bundle/agent/a/index.js dist/packages/lib/package/agent/a/index.js',
      'ncp packages/lib/src/agent/Dockerfile dist/packages/lib/bundle/agent/a/Dockerfile',
      'ncp packages/lib/.trivyignore dist/packages/lib/trivy/img/.trivyignore',
    ]);

    await migration(tree);

    expect(commandsOf(tree, 'lib', 'package')).toEqual([
      'shx cp dist/packages/lib/bundle/agent/a/index.js dist/packages/lib/package/agent/a/index.js',
      'shx cp packages/lib/src/agent/Dockerfile dist/packages/lib/bundle/agent/a/Dockerfile',
      'shx cp packages/lib/.trivyignore dist/packages/lib/trivy/img/.trivyignore',
    ]);
  });

  it('should rewrite a directory copy with -R and a trailing /.', async () => {
    addTarget(tree, 'py_lib', 'package', [
      'ncp dist/packages/py_lib/bundle-arm dist/packages/py_lib/package/agent/a',
      'ncp dist/packages/py_lib/bundle-x86 dist/packages/py_lib/docker/a',
      'ncp dist/api/model/build/ssdk packages/api/src/generated/ssdk',
      'ncp prisma dist/packages/lib/bundle/migration/prisma',
      'ncp packages/py_lib/migrations dist/packages/py_lib/docker/migration/migrations',
    ]);

    await migration(tree);

    expect(commandsOf(tree, 'py_lib', 'package')).toEqual([
      'shx cp -R dist/packages/py_lib/bundle-arm/. dist/packages/py_lib/package/agent/a',
      'shx cp -R dist/packages/py_lib/bundle-x86/. dist/packages/py_lib/docker/a',
      'shx cp -R dist/api/model/build/ssdk/. packages/api/src/generated/ssdk',
      'shx cp -R prisma/. dist/packages/lib/bundle/migration/prisma',
      'shx cp -R packages/py_lib/migrations/. dist/packages/py_lib/docker/migration/migrations',
    ]);
  });

  it('should treat a python module tree as a directory', async () => {
    addTarget(tree, 'py_lib', 'package', [
      'ncp packages/py_lib/py_lib/my_agent dist/packages/py_lib/package/agent/a/my_agent',
    ]);

    await migration(tree);

    expect(commandsOf(tree, 'py_lib', 'package')).toEqual([
      'shx cp -R packages/py_lib/py_lib/my_agent/. dist/packages/py_lib/package/agent/a/my_agent',
    ]);
  });

  it('should rewrite a renamed Dockerfile copy as a file copy', async () => {
    addTarget(tree, 'py_lib', 'bundle-migration', [
      'ncp packages/py_lib/Dockerfile.migration dist/packages/py_lib/docker/migration/Dockerfile',
    ]);

    await migration(tree);

    expect(commandsOf(tree, 'py_lib', 'bundle-migration')).toEqual([
      'shx cp packages/py_lib/Dockerfile.migration dist/packages/py_lib/docker/migration/Dockerfile',
    ]);
  });

  it('should rewrite the glob copy into a mkdir and a cp', async () => {
    addTarget(tree, 'model', 'compile', [
      'cpy "dist/packages/model/smithy/source/openapi/*.openapi.json" dist/packages/model/build/openapi --flat --rename=openapi.json',
    ]);

    await migration(tree);

    expect(commandsOf(tree, 'model', 'compile')).toEqual([
      'shx mkdir -p dist/packages/model/build/openapi',
      'shx cp "dist/packages/model/smithy/source/openapi/*.openapi.json" dist/packages/model/build/openapi/openapi.json',
    ]);
  });

  it('should pin a target whose command it split to running in order', async () => {
    addProjectConfiguration(tree, 'model', {
      root: 'packages/model',
      targets: {
        compile: {
          executor: 'nx:run-commands',
          options: {
            commands: [
              'cpy "dist/packages/model/openapi/*.openapi.json" dist/packages/model/build/openapi --flat --rename=openapi.json',
            ],
          },
        },
      },
    });

    await migration(tree);

    expect(optionsOf(tree, 'model', 'compile')?.parallel).toBe(false);
  });

  it('should turn a split single command option into commands', async () => {
    addProjectConfiguration(tree, 'model', {
      root: 'packages/model',
      targets: {
        compile: {
          executor: 'nx:run-commands',
          options: {
            command:
              'cpy "dist/packages/model/openapi/*.openapi.json" dist/packages/model/build/openapi --flat --rename=openapi.json',
          },
        },
      },
    });

    await migration(tree);

    const options = optionsOf(tree, 'model', 'compile');
    expect(options?.command).toBeUndefined();
    expect(options?.commands).toEqual([
      'shx mkdir -p dist/packages/model/build/openapi',
      'shx cp "dist/packages/model/openapi/*.openapi.json" dist/packages/model/build/openapi/openapi.json',
    ]);
    expect(options?.parallel).toBe(false);
  });

  it('should split a glob copy given as an object, preserving its other keys', async () => {
    addTarget(tree, 'model', 'compile', [
      {
        command:
          'cpy "dist/packages/model/openapi/*.openapi.json" dist/packages/model/build/openapi --flat --rename=openapi.json',
        forwardAllArgs: false,
      },
    ]);

    await migration(tree);

    expect(commandsOf(tree, 'model', 'compile')).toEqual([
      {
        command: 'shx mkdir -p dist/packages/model/build/openapi',
        forwardAllArgs: false,
      },
      {
        command:
          'shx cp "dist/packages/model/openapi/*.openapi.json" dist/packages/model/build/openapi/openapi.json',
        forwardAllArgs: false,
      },
    ]);
  });

  it('should rewrite commands given as objects, preserving their other keys', async () => {
    addTarget(tree, 'infra', 'init', [
      {
        command: 'make-dir .terraform/plugin-cache/packages/infra',
        forwardAllArgs: false,
      },
      'terraform init',
    ]);

    await migration(tree);

    expect(commandsOf(tree, 'infra', 'init')).toEqual([
      {
        command: 'shx mkdir -p .terraform/plugin-cache/packages/infra',
        forwardAllArgs: false,
      },
      'terraform init',
    ]);
  });

  it('should rewrite a single command option', async () => {
    addProjectConfiguration(tree, 'lib', {
      root: 'packages/lib',
      targets: {
        clean: {
          executor: 'nx:run-commands',
          options: { command: 'rimraf dist/packages/lib' },
        },
      },
    });

    await migration(tree);

    expect(
      readProjectConfiguration(tree, 'lib').targets?.clean?.options?.command,
    ).toBe('shx rm -rf dist/packages/lib');
  });

  it('should swap the four CLIs for shx in the root package.json', async () => {
    addTarget(tree, 'lib', 'package', ['rimraf dist/packages/lib/package']);

    await migration(tree);

    const { devDependencies } = readJson(tree, 'package.json');
    expect(devDependencies.shx).toBeDefined();
    expect(devDependencies.ncp).toBeUndefined();
    expect(devDependencies.rimraf).toBeUndefined();
    expect(devDependencies['make-dir-cli']).toBeUndefined();
    expect(devDependencies['cpy-cli']).toBeUndefined();
  });

  it('should leave a copy it cannot classify untouched and report it', async () => {
    addTarget(tree, 'lib', 'package', [
      'rimraf dist/packages/lib/package',
      'ncp some/custom/thing dist/packages/lib/package/elsewhere',
    ]);

    const { nextSteps } = await migration(tree);

    expect(commandsOf(tree, 'lib', 'package')).toEqual([
      'shx rm -rf dist/packages/lib/package',
      'ncp some/custom/thing dist/packages/lib/package/elsewhere',
    ]);
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain('ncp some/custom/thing');
  });

  it('should keep ncp installed when a command it could not rewrite still runs it', async () => {
    addTarget(tree, 'lib', 'package', [
      'ncp some/custom/thing dist/packages/lib/package/elsewhere',
    ]);

    await migration(tree);

    const { devDependencies } = readJson(tree, 'package.json');
    expect(devDependencies.ncp).toBe('2.0.0');
    expect(devDependencies.rimraf).toBeUndefined();
  });

  it('should leave an unrelated command alone', async () => {
    addTarget(tree, 'lib', 'build', [
      'rolldown -c rolldown.config.ts',
      'docker build -t img .',
    ]);

    await migration(tree);

    expect(commandsOf(tree, 'lib', 'build')).toEqual([
      'rolldown -c rolldown.config.ts',
      'docker build -t img .',
    ]);
  });

  it('should be a no-op on a second run', async () => {
    addTarget(tree, 'py_lib', 'package', [
      'rimraf dist/packages/py_lib/package',
      'make-dir dist/packages/py_lib/package',
      'ncp dist/packages/py_lib/bundle-arm dist/packages/py_lib/package',
      'ncp packages/py_lib/main.py dist/packages/py_lib/package/main.py',
    ]);

    await migration(tree);
    const afterFirst = commandsOf(tree, 'py_lib', 'package');
    const { nextSteps } = await migration(tree);

    expect(commandsOf(tree, 'py_lib', 'package')).toEqual(afterFirst);
    expect(nextSteps).toHaveLength(0);
  });
});
