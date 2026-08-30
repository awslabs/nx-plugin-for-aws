/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

const PROJECT = '@proj/lib';

/** A cacheable target with no `inputs`, as the generators vended it. */
const target = (outputDir: string) => ({
  cache: true,
  executor: 'nx:run-commands',
  outputs: [`{workspaceRoot}/dist/{projectRoot}/${outputDir}`],
  options: { command: 'do-something' },
});

const addProject = (tree: Tree, targets: Record<string, unknown>) =>
  addProjectConfiguration(tree, PROJECT, {
    root: 'packages/lib',
    targets: targets as never,
  });

const inputsOf = (tree: Tree, name: string) =>
  readProjectConfiguration(tree, PROJECT).targets[name].inputs;

describe('declare-cacheable-target-inputs migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it.each([
    'bundle',
    'bundle-migration',
    'bundle-create-db-user',
    'operations',
    'openapi',
    'my-agent-openapi',
  ])('should narrow %s to the default input', async (name) => {
    addProject(tree, { [name]: target(name) });

    await migration(tree);

    // Nx's implicit inputs for a target declaring none are
    // `["default", "^default"]`, which reads a dependency's whole project
    // directory rather than the build artifacts these targets consume.
    expect(inputsOf(tree, name)).toEqual(['default']);
  });

  it('should keep the dependency edge on checkov, which resolves consumed modules', async () => {
    addProject(tree, { checkov: target('checkov') });

    await migration(tree);

    expect(inputsOf(tree, 'checkov')).toEqual(['default', '^production']);
  });

  it('should leave inputs the user has already declared alone', async () => {
    addProject(tree, {
      bundle: { ...target('bundle'), inputs: ['production', '^production'] },
    });

    await migration(tree);

    expect(inputsOf(tree, 'bundle')).toEqual(['production', '^production']);
  });

  it('should leave an uncached target alone', async () => {
    addProject(tree, { bundle: { ...target('bundle'), cache: false } });

    await migration(tree);

    expect(inputsOf(tree, 'bundle')).toBeUndefined();
  });

  it('should leave a target this migration does not name alone', async () => {
    addProject(tree, { compile: target('tsc') });

    await migration(tree);

    expect(inputsOf(tree, 'compile')).toBeUndefined();
  });

  it('should skip a target pointed away from the vended output shape', async () => {
    addProject(tree, {
      bundle: { ...target('bundle'), outputs: ['{projectRoot}/out'] },
      openapi: { ...target('openapi'), executor: '@my/plugin:build' },
    });

    await migration(tree);

    expect(inputsOf(tree, 'bundle')).toBeUndefined();
    expect(inputsOf(tree, 'openapi')).toBeUndefined();
  });

  it('should preserve the rest of the target configuration', async () => {
    const bundle = target('bundle');
    addProject(tree, { bundle });

    await migration(tree);

    expect(readProjectConfiguration(tree, PROJECT).targets.bundle).toEqual({
      ...bundle,
      inputs: ['default'],
    });
  });

  it('should be idempotent', async () => {
    addProject(tree, {
      bundle: target('bundle'),
      checkov: target('checkov'),
      openapi: target('openapi'),
    });

    await migration(tree);
    const after = tree.read('packages/lib/project.json', 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(tree.read('packages/lib/project.json', 'utf-8')).toBe(after);
    expect(nextSteps).toEqual([]);
  });
});
