/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { tsInfraGenerator } from '../../../infra/app/generator.js';
import terraformProjectGenerator from '../../../terraform/project/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const CONSTRUCTS_ROOT = 'packages/common/constructs';
const GLOBAL_SETUP_LINE = "    globalSetup: ['./tests/global-setup.ts'],\n";

/** The infra `vitest.config.mts` that 1.0.6 generates, byte for byte. */
const PRE_FIX_INFRA_VITEST_CONFIG = `import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/packages/infra',
  test: {
    passWithNoTests: true,
    name: '@proj/infra',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../dist/packages/infra/test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
`;

/** The files the migration touches for a project rooted at `root`. */
const touchedFiles = (root: string) => [
  `${root}/vitest.config.mts`,
  `${root}/tests/global-setup.ts`,
];

const readAll = (tree: Tree, paths: string[]) =>
  Object.fromEntries(paths.map((path) => [path, tree.read(path, 'utf-8')]));

/**
 * Every file in the tree, for asserting that nothing changed. Format before
 * taking it: `formatFilesInSubtree` formats every file changed since the tree
 * was created, which in a test includes the fixture itself.
 */
const allFiles = (tree: Tree, dir = ''): Record<string, string> => {
  const files: Record<string, string> = {};
  for (const child of tree.children(dir)) {
    const path = dir ? `${dir}/${child}` : child;
    if (tree.isFile(path)) {
      files[path] = tree.read(path, 'utf-8') ?? '';
    } else {
      Object.assign(files, allFiles(tree, path));
    }
  }
  return files;
};

/** Reverts one project's test setup to what 1.0.6 generated. */
const revertProject = (tree: Tree, projectName: string, root: string) => {
  const config = readProjectConfiguration(tree, projectName);
  delete config.targets.test;
  updateProjectConfiguration(tree, projectName, config);
  tree.delete(`${root}/tests/global-setup.ts`);
  const vitestConfig = `${root}/vitest.config.mts`;
  tree.write(
    vitestConfig,
    (tree.read(vitestConfig, 'utf-8') ?? '').replace(GLOBAL_SETUP_LINE, ''),
  );
};

interface Fixture {
  /** The touched files as the generator writes them today. */
  fresh: Record<string, string | null>;
  paths: string[];
}

/**
 * Generates infrastructure projects, records what the generator writes today,
 * then reverts every file this migration touches to the 1.0.6 shape - so the
 * fixture is what users are upgrading from rather than something derived.
 */
const generatePreFixWorkspace = async (
  tree: Tree,
  projects: { name: string; stageConfig?: boolean }[] = [{ name: 'infra' }],
): Promise<Fixture> => {
  for (const { name, stageConfig } of projects) {
    await tsInfraGenerator(tree, { name, directory: 'packages', stageConfig });
  }
  const paths = [
    ...projects.flatMap(({ name }) => [
      `packages/${name}/project.json`,
      ...touchedFiles(`packages/${name}`),
    ]),
    ...touchedFiles(CONSTRUCTS_ROOT),
  ];
  const fresh = readAll(tree, paths);

  for (const { name } of projects) {
    revertProject(tree, `@proj/${name}`, `packages/${name}`);
  }
  // common-constructs has no test target of its own to revert.
  tree.delete(`${CONSTRUCTS_ROOT}/tests/global-setup.ts`);
  tree.write(
    `${CONSTRUCTS_ROOT}/vitest.config.mts`,
    (tree.read(`${CONSTRUCTS_ROOT}/vitest.config.mts`, 'utf-8') ?? '').replace(
      GLOBAL_SETUP_LINE,
      '',
    ),
  );
  await formatFilesInSubtree(tree);

  return { fresh, paths };
};

describe('infra-test-loop migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should start from a fixture carrying the 1.0.6 shape', async () => {
    // Guards the fixture: without this the assertions below could pass without
    // the migration doing anything.
    await generatePreFixWorkspace(tree);

    expect(
      readProjectConfiguration(tree, '@proj/infra').targets.test,
    ).toBeUndefined();
    expect(tree.read('packages/infra/vitest.config.mts', 'utf-8')).toBe(
      PRE_FIX_INFRA_VITEST_CONFIG,
    );
    for (const root of ['packages/infra', CONSTRUCTS_ROOT]) {
      expect(tree.exists(`${root}/tests/global-setup.ts`)).toBe(false);
      expect(tree.read(`${root}/vitest.config.mts`, 'utf-8')).not.toContain(
        'globalSetup',
      );
    }
  });

  it('should converge on what the generator writes today', async () => {
    const { fresh, paths } = await generatePreFixWorkspace(tree);

    const result = await migration(tree);

    expect(readAll(tree, paths)).toEqual(fresh);
    expect(result.nextSteps).toEqual([]);
  });

  it('should be a no-op on a freshly generated workspace', async () => {
    await tsInfraGenerator(tree, { name: 'infra', directory: 'packages' });
    await formatFilesInSubtree(tree);
    const before = allFiles(tree);

    const result = await migration(tree);

    expect(allFiles(tree)).toEqual(before);
    expect(result.nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    await generatePreFixWorkspace(tree);
    await migration(tree);
    const afterFirst = allFiles(tree);

    const result = await migration(tree);

    expect(allFiles(tree)).toEqual(afterFirst);
    expect(result.nextSteps).toEqual([]);
  });

  it('should migrate every infrastructure project', async () => {
    const { fresh, paths } = await generatePreFixWorkspace(tree, [
      { name: 'infra' },
      { name: 'infra-with-stages', stageConfig: true },
    ]);

    const result = await migration(tree);

    expect(readAll(tree, paths)).toEqual(fresh);
    expect(result.nextSteps).toEqual([]);
  });

  describe('diverged files', () => {
    it('should leave a customised test target untouched and report it', async () => {
      await generatePreFixWorkspace(tree);
      const config = readProjectConfiguration(tree, '@proj/infra');
      config.targets.test = { dependsOn: ['^build', 'foo:bar'] };
      updateProjectConfiguration(tree, '@proj/infra', config);
      await formatFilesInSubtree(tree);
      const before = tree.read('packages/infra/project.json', 'utf-8');

      const result = await migration(tree);

      expect(tree.read('packages/infra/project.json', 'utf-8')).toBe(before);
      expect(result.nextSteps).toEqual([
        expect.stringMatching(/@proj\/infra.*packages\/infra\/project\.json/),
      ]);
    });

    it('should leave a config with its own global setup untouched and report it', async () => {
      await generatePreFixWorkspace(tree);
      const configPath = 'packages/infra/vitest.config.mts';
      tree.write(
        configPath,
        (tree.read(configPath, 'utf-8') ?? '').replace(
          'test: {',
          "test: {\n    globalSetup: ['./mine.ts'],",
        ),
      );
      const before = tree.read(configPath, 'utf-8');

      const result = await migration(tree);

      expect(tree.read(configPath, 'utf-8')).toBe(before);
      expect(tree.exists('packages/infra/tests/global-setup.ts')).toBe(false);
      expect(result.nextSteps).toEqual([
        expect.stringMatching(
          /@proj\/infra.*packages\/infra\/vitest\.config\.mts/,
        ),
      ]);
    });

    it('should leave a global setup the user wrote untouched and report it', async () => {
      await generatePreFixWorkspace(tree);
      const setupPath = 'packages/infra/tests/global-setup.ts';
      const userSetup = 'export default function setup() {}\n';
      tree.write(setupPath, userSetup);
      const configBefore = tree.read(
        'packages/infra/vitest.config.mts',
        'utf-8',
      );

      const result = await migration(tree);

      expect(tree.read(setupPath, 'utf-8')).toBe(userSetup);
      // Registering a setup the plugin did not write could change the user's
      // tests, so the config is left alone too.
      expect(tree.read('packages/infra/vitest.config.mts', 'utf-8')).toBe(
        configBefore,
      );
      expect(result.nextSteps).toEqual([
        expect.stringMatching(
          /@proj\/infra.*packages\/infra\/tests\/global-setup\.ts/,
        ),
      ]);
    });

    it('should report a vitest config it does not recognise', async () => {
      await generatePreFixWorkspace(tree);
      const configPath = `${CONSTRUCTS_ROOT}/vitest.config.mts`;
      const custom = `export default { test: {} };\n`;
      tree.write(configPath, custom);

      const result = await migration(tree);

      expect(tree.read(configPath, 'utf-8')).toBe(custom);
      expect(tree.exists(`${CONSTRUCTS_ROOT}/tests/global-setup.ts`)).toBe(
        false,
      );
      expect(result.nextSteps).toEqual([expect.stringContaining(configPath)]);
    });
  });

  it('should be a no-op when the workspace has no infrastructure project', async () => {
    await formatFilesInSubtree(tree);
    const before = allFiles(tree);

    const result = await migration(tree);

    expect(allFiles(tree)).toEqual(before);
    expect(result.nextSteps).toEqual([]);
  });

  it('should be a no-op in a terraform workspace', async () => {
    await terraformProjectGenerator(tree, {
      name: 'infra',
      type: 'application',
      directory: 'packages',
    });
    await formatFilesInSubtree(tree);
    const before = allFiles(tree);

    const result = await migration(tree);

    expect(allFiles(tree)).toEqual(before);
    expect(result.nextSteps).toEqual([]);
  });

  it('should leave a project this generator did not create alone', async () => {
    addProjectConfiguration(tree, '@proj/other', {
      root: 'packages/other',
      targets: {},
    });
    tree.write('packages/other/vitest.config.mts', PRE_FIX_INFRA_VITEST_CONFIG);
    await formatFilesInSubtree(tree);
    const before = allFiles(tree);

    const result = await migration(tree);

    expect(allFiles(tree)).toEqual(before);
    expect(result.nextSteps).toEqual([]);
  });

  it('should preserve user infrastructure code', async () => {
    await generatePreFixWorkspace(tree);

    const stackPath = 'packages/infra/src/stacks/application-stack.ts';
    const userStack = `import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class ApplicationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // My own infrastructure
  }
}
`;
    tree.write(stackPath, userStack);

    await migration(tree);

    expect(tree.read(stackPath, 'utf-8')).toBe(userStack);
  });
});
