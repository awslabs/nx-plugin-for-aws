/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readJson,
  readProjectConfiguration,
  type Tree,
} from '@nx/devkit';
import { AGENTCORE_GATEWAY_GENERATOR_INFO } from '../../../agentcore-gateway/generator.js';
import { AGENTCORE_HARNESS_GENERATOR_INFO } from '../../../agentcore-harness/generator.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

/** Seeds a Gateway project as the pre-migration generator left it. */
const seedGateway = (tree: Tree, name = '@proj/my-gateway') => {
  const root = `packages/${name.split('/').pop()}`;
  addProjectConfiguration(tree, name, {
    name,
    root,
    projectType: 'library',
    sourceRoot: root,
    tags: [],
    targets: {
      serve: {
        executor: 'nx:run-commands',
        continuous: true,
        dependsOn: [],
        options: { command: 'tsx local-dev.ts', cwd: '{projectRoot}' },
      },
      dev: {
        executor: 'nx:run-commands',
        continuous: true,
        dependsOn: [],
        options: { command: 'tsx local-dev.ts', cwd: '{projectRoot}' },
      },
    },
    metadata: { generator: AGENTCORE_GATEWAY_GENERATOR_INFO.id } as never,
  });
  tree.write(`${root}/local-dev.ts`, 'export const port = 8100;\n');
  return root;
};

/** Seeds a Harness project as the pre-migration generator left it. */
const seedHarness = (tree: Tree, name = '@proj/my-harness') => {
  const root = `packages/${name.split('/').pop()}`;
  addProjectConfiguration(tree, name, {
    name,
    root,
    projectType: 'application',
    sourceRoot: root,
    tags: [],
    targets: {
      chat: {
        executor: 'nx:run-commands',
        options: { commands: ['tsx ./scripts/chat.ts'], cwd: '{projectRoot}' },
      },
    },
    metadata: { generator: AGENTCORE_HARNESS_GENERATOR_INFO.id } as never,
  });
  tree.write(`${root}/scripts/chat.ts`, 'export const name = "harness";\n');
  return root;
};

describe('script-project-quality-gates migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should add the quality gates to a gateway project', async () => {
    const root = seedGateway(tree);

    await migration(tree);

    const project = readProjectConfiguration(tree, '@proj/my-gateway');
    expect(project.targets.build.dependsOn).toEqual(['lint', 'typecheck']);
    expect(project.targets.typecheck.options.command).toBe(
      'tsc --noEmit -p tsconfig.json',
    );
    expect(project.targets.lint.dependsOn).toEqual(['format']);
    expect(project.targets.format).toBeDefined();
    // The existing targets survive.
    expect(project.targets.dev.options.command).toBe('tsx local-dev.ts');

    const tsConfig = readJson(tree, `${root}/tsconfig.json`);
    expect(tsConfig.compilerOptions.noEmit).toBe(true);
    expect(tsConfig.compilerOptions.composite).toBe(false);
    expect(tsConfig.include).toEqual(['**/*.ts']);
  });

  it('should add the quality gates to a harness project', async () => {
    const root = seedHarness(tree);

    await migration(tree);

    const project = readProjectConfiguration(tree, '@proj/my-harness');
    expect(project.targets.build.dependsOn).toEqual(['lint', 'typecheck']);
    expect(project.targets.typecheck).toBeDefined();
    expect(project.targets.chat).toBeDefined();
    expect(tree.exists(`${root}/tsconfig.json`)).toBe(true);
  });

  it('should not add a project reference for the noEmit tsconfig', async () => {
    seedGateway(tree);

    await migration(tree);

    const rootTsConfig = readJson(tree, 'tsconfig.json');
    expect(
      (rootTsConfig.references ?? []).map(
        (reference: { path: string }) => reference.path,
      ),
    ).not.toContain('./packages/my-gateway');
  });

  it('should leave unrelated projects alone', async () => {
    addProjectConfiguration(tree, '@proj/other', {
      name: '@proj/other',
      root: 'packages/other',
      targets: { compile: { executor: 'nx:run-commands' } },
      metadata: { generator: 'ts#project' } as never,
    });

    await migration(tree);

    const project = readProjectConfiguration(tree, '@proj/other');
    expect(project.targets.typecheck).toBeUndefined();
    expect(tree.exists('packages/other/tsconfig.json')).toBe(false);
  });

  it('should skip and report a project reworked into a compiled project', async () => {
    const root = seedGateway(tree);
    tree.write(`${root}/tsconfig.lib.json`, JSON.stringify({ include: [] }));

    const result = await migration(tree);

    const project = readProjectConfiguration(tree, '@proj/my-gateway');
    expect(project.targets.typecheck).toBeUndefined();
    expect(project.targets.build).toBeUndefined();
    expect(result.nextSteps).toEqual([
      expect.stringContaining('@proj/my-gateway'),
    ]);
  });

  it('should preserve a user-customised tsconfig.json', async () => {
    const root = seedGateway(tree);
    tree.write(
      `${root}/tsconfig.json`,
      JSON.stringify({
        extends: '../../tsconfig.base.json',
        compilerOptions: { noEmit: true, strict: false },
      }),
    );

    await migration(tree);

    const tsConfig = readJson(tree, `${root}/tsconfig.json`);
    expect(tsConfig.compilerOptions.strict).toBe(false);
  });

  it('should be idempotent', async () => {
    seedGateway(tree);
    seedHarness(tree);

    await migration(tree);
    const after = readProjectConfiguration(tree, '@proj/my-gateway');
    const tsConfigAfter = tree.read(
      'packages/my-gateway/tsconfig.json',
      'utf-8',
    );
    // User content written between runs must survive the second run.
    tree.write(
      'packages/my-gateway/local-dev.ts',
      'export const port = 9999; // hand edited\n',
    );

    await migration(tree);

    expect(readProjectConfiguration(tree, '@proj/my-gateway')).toEqual(after);
    expect(tree.read('packages/my-gateway/tsconfig.json', 'utf-8')).toEqual(
      tsConfigAfter,
    );
    expect(tree.read('packages/my-gateway/local-dev.ts', 'utf-8')).toContain(
      'hand edited',
    );
  });
});
