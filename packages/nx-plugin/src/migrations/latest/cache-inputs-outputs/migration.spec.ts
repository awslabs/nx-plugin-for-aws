/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readNxJson,
  readProjectConfiguration,
  type Tree,
  updateNxJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import { beforeEach, describe, expect, it } from 'vitest';
import { smithyProjectGenerator } from '../../../smithy/project/generator.js';
import { terraformProjectGenerator } from '../../../terraform/project/generator.js';
import { DEPENDENT_TASKS_OUTPUT_FILES_INPUT } from '../../../ts/lib/generator.js';
import { tsRdbGenerator } from '../../../ts/rdb/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

/** The dependent task output glob 1.0.6 and earlier vended. */
const PRE_FIX_GLOB = '!{reports,coverage}/**';

const SMITHY_SERVICE = '@proj/api';
const SMITHY_SHAPES = '@proj/shapes';
const RDB = '@proj/db';
const TERRAFORM = '@proj/tf';

const PROJECT_FILES = [
  'packages/api/project.json',
  'packages/shapes/project.json',
  'packages/db/project.json',
  'packages/tf/project.json',
];

const smithy = (tree: Tree, name: string, type?: 'shapes') =>
  smithyProjectGenerator(tree, {
    name,
    directory: 'packages',
    ...(type ? { type } : {}),
  });

const terraform = (tree: Tree, name: string) =>
  terraformProjectGenerator(tree, {
    name,
    type: 'application',
    directory: 'packages',
  });

/** A workspace carrying every project this migration touches, as generated today. */
const generateWorkspace = async (tree: Tree) => {
  await tsRdbGenerator(tree, {
    name: 'db',
    directory: 'packages',
    infra: 'none',
    engine: 'postgres',
    framework: 'prisma',
    iac: 'cdk',
    preferInstallDependencies: false,
  });
  await smithy(tree, 'api');
  await smithy(tree, 'shapes', 'shapes');
  await terraform(tree, 'tf');
};

const revertGlob = (tree: Tree) => {
  const nxJson = readNxJson(tree);
  nxJson.namedInputs.default = nxJson.namedInputs.default.map((input) =>
    typeof input === 'object' && 'dependentTasksOutputFiles' in input
      ? { ...input, dependentTasksOutputFiles: PRE_FIX_GLOB }
      : input,
  );
  updateNxJson(tree, nxJson);
};

const revertSmithy = (tree: Tree, projectName: string) => {
  const config = readProjectConfiguration(tree, projectName);
  for (const name of ['compile', 'generate-ssdk']) {
    if (config.targets[name]) delete config.targets[name].inputs;
  }
  updateProjectConfiguration(tree, projectName, config);
};

const revertRdb = (tree: Tree, projectName: string) => {
  const config = readProjectConfiguration(tree, projectName);
  const { executor, outputs, options } = config.targets.generate;
  config.targets.generate = { executor, outputs, options };
  updateProjectConfiguration(tree, projectName, config);
};

const revertTerraform = (tree: Tree, projectName: string) => {
  const config = readProjectConfiguration(tree, projectName);
  const { executor, options } = config.targets.output;
  config.targets.output = {
    executor,
    cache: true,
    inputs: ['default'],
    options,
  };
  updateProjectConfiguration(tree, projectName, config);
};

/**
 * Reverts a freshly generated workspace to the shapes the 1.0.6 generators
 * wrote, key order included, so the fixture is what users upgrade from rather
 * than something derived from the migration.
 */
const revertToPreFix = async (
  tree: Tree,
  projects: {
    smithy?: string[];
    rdb?: string[];
    terraform?: string[];
  } = {
    smithy: [SMITHY_SERVICE, SMITHY_SHAPES],
    rdb: [RDB],
    terraform: [TERRAFORM],
  },
) => {
  revertGlob(tree);
  for (const p of projects.smithy ?? []) revertSmithy(tree, p);
  for (const p of projects.rdb ?? []) revertRdb(tree, p);
  for (const p of projects.terraform ?? []) revertTerraform(tree, p);
  await formatFilesInSubtree(tree);
};

/** Every file in the tree, by path, so a comparison covers the whole workspace. */
const snapshotTree = (tree: Tree, dir = ''): Record<string, string> =>
  Object.fromEntries(
    tree.children(dir).flatMap((child) => {
      const path = dir ? `${dir}/${child}` : child;
      return tree.isFile(path)
        ? [[path, tree.read(path, 'utf-8') ?? '']]
        : Object.entries(snapshotTree(tree, path));
    }),
  );

const stalePassAdvisory = (nextSteps: string[]) =>
  nextSteps.filter((step) => step.includes('replay a cached result'));

describe('cache-inputs-outputs migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should start from a fixture carrying the pre-fix shapes', async () => {
    // Guards the fixture: without this the convergence test could pass
    // without the migration doing anything.
    const fresh = createTreeUsingTsSolutionSetup();
    await generateWorkspace(fresh);
    await generateWorkspace(tree);
    await revertToPreFix(tree);

    for (const path of ['nx.json', ...PROJECT_FILES]) {
      expect(tree.read(path, 'utf-8')).not.toEqual(fresh.read(path, 'utf-8'));
    }
    expect(tree.read('nx.json', 'utf-8')).toContain(PRE_FIX_GLOB);
  });

  it('should converge byte-identically on what the generators write today', async () => {
    const fresh = createTreeUsingTsSolutionSetup();
    await generateWorkspace(fresh);
    await generateWorkspace(tree);
    await revertToPreFix(tree);

    const { nextSteps } = await migration(tree);

    expect(snapshotTree(tree)).toEqual(snapshotTree(fresh));
    expect(nextSteps).toHaveLength(1);
    expect(stalePassAdvisory(nextSteps)).toHaveLength(1);
  });

  it('should be a no-op on a freshly generated workspace', async () => {
    await generateWorkspace(tree);
    const before = snapshotTree(tree);

    const { nextSteps } = await migration(tree);

    expect(snapshotTree(tree)).toEqual(before);
    expect(nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    await generateWorkspace(tree);
    await revertToPreFix(tree);
    await migration(tree);
    const afterFirst = snapshotTree(tree);

    const { nextSteps } = await migration(tree);

    expect(snapshotTree(tree)).toEqual(afterFirst);
    expect(nextSteps).toEqual([]);
  });

  it('should migrate every matching project', async () => {
    const build = async (t: Tree) => {
      await generateWorkspace(t);
      await smithy(t, 'api-two');
      await terraform(t, 'tf-two');
    };
    const fresh = createTreeUsingTsSolutionSetup();
    await build(fresh);
    await build(tree);
    await revertToPreFix(tree, {
      smithy: [SMITHY_SERVICE, SMITHY_SHAPES, '@proj/api-two'],
      rdb: [RDB],
      terraform: [TERRAFORM, '@proj/tf-two'],
    });

    await migration(tree);

    expect(snapshotTree(tree)).toEqual(snapshotTree(fresh));
  });

  it('should leave a customised dependent task output glob untouched and report it', async () => {
    await generateWorkspace(tree);
    const nxJson = readNxJson(tree);
    nxJson.namedInputs.default = nxJson.namedInputs.default.map((input) =>
      typeof input === 'object' && 'dependentTasksOutputFiles' in input
        ? { ...input, dependentTasksOutputFiles: 'build/**' }
        : input,
    );
    updateNxJson(tree, nxJson);
    await formatFilesInSubtree(tree);
    const before = tree.read('nx.json', 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(tree.read('nx.json', 'utf-8')).toEqual(before);
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain('dependentTasksOutputFiles');
    expect(stalePassAdvisory(nextSteps)).toEqual([]);
  });

  describe('diverged targets', () => {
    const divergeAndMigrate = async (
      projectName: string,
      targetName: string,
      edit: (target: Record<string, unknown>) => void,
    ) => {
      await generateWorkspace(tree);
      await revertToPreFix(tree);
      const config = readProjectConfiguration(tree, projectName);
      edit(config.targets[targetName] as Record<string, unknown>);
      updateProjectConfiguration(tree, projectName, config);
      await formatFilesInSubtree(tree);
      const before = readProjectConfiguration(tree, projectName).targets[
        targetName
      ];

      const { nextSteps } = await migration(tree);

      expect(
        readProjectConfiguration(tree, projectName).targets[targetName],
      ).toEqual(before);
      expect(
        nextSteps.filter((step) =>
          step.startsWith(`${projectName}:${targetName}`),
        ),
      ).toHaveLength(1);
    };

    it('should leave a smithy compile with its own inputs untouched and report it', async () => {
      await divergeAndMigrate(SMITHY_SERVICE, 'compile', (target) => {
        target.inputs = ['production'];
      });
    });

    it('should leave a smithy generate-ssdk with its own inputs untouched and report it', async () => {
      await divergeAndMigrate(SMITHY_SERVICE, 'generate-ssdk', (target) => {
        target.inputs = ['{projectRoot}/ssdk.rolldown.config.mjs'];
      });
    });

    it('should leave an rdb generate the user stopped caching untouched and report it', async () => {
      await divergeAndMigrate(RDB, 'generate', (target) => {
        target.cache = false;
      });
    });

    it('should leave an rdb generate with a changed command untouched and report it', async () => {
      await divergeAndMigrate(RDB, 'generate', (target) => {
        target.options = {
          command: 'prisma generate --no-hints',
          cwd: '{projectRoot}',
        };
      });
    });

    it('should leave a terraform output with custom inputs untouched and report it', async () => {
      await divergeAndMigrate(TERRAFORM, 'output', (target) => {
        target.inputs = ['{projectRoot}/src/**/*.tf'];
      });
    });
  });

  it('should leave a terraform output the user already stopped caching alone', async () => {
    await generateWorkspace(tree);
    await revertToPreFix(tree);
    const config = readProjectConfiguration(tree, TERRAFORM);
    config.targets.output.cache = false;
    updateProjectConfiguration(tree, TERRAFORM, config);
    await formatFilesInSubtree(tree);
    const before = tree.read('packages/tf/project.json', 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(tree.read('packages/tf/project.json', 'utf-8')).toEqual(before);
    expect(nextSteps.filter((step) => step.startsWith(TERRAFORM))).toEqual([]);
  });

  it('should be a no-op in a workspace without these projects', async () => {
    // A real workspace is already formatted; the bare test tree is not.
    await formatFilesInSubtree(tree);
    const before = snapshotTree(tree);

    const { nextSteps } = await migration(tree);

    expect(snapshotTree(tree)).toEqual(before);
    expect(nextSteps).toEqual([]);
  });

  it('should leave projects other generators created alone', async () => {
    const targets = {
      compile: {
        executor: 'nx:run-commands',
        cache: true,
        options: { command: 'tsc' },
      },
      generate: {
        executor: 'nx:run-commands',
        outputs: ['{projectRoot}/generated/prisma'],
        options: { command: 'prisma generate', cwd: '{projectRoot}' },
      },
      output: {
        executor: 'nx:run-commands',
        cache: true,
        inputs: ['default'],
        options: { command: 'terraform output -json' },
      },
    };
    addProjectConfiguration(tree, '@proj/plain', {
      root: 'packages/plain',
      targets,
    });
    addProjectConfiguration(tree, '@proj/other', {
      root: 'packages/other',
      metadata: { generator: 'ts#project' } as Record<string, unknown>,
      targets,
    });
    await formatFilesInSubtree(tree);
    const before = snapshotTree(tree);

    const { nextSteps } = await migration(tree);

    expect(snapshotTree(tree)).toEqual(before);
    expect(nextSteps).toEqual([]);
  });

  it('should report the stale-pass risk only when it rewrote the glob', async () => {
    await generateWorkspace(tree);
    await revertToPreFix(tree);
    expect(stalePassAdvisory((await migration(tree)).nextSteps)).toHaveLength(
      1,
    );

    const fresh = createTreeUsingTsSolutionSetup();
    await generateWorkspace(fresh);
    expect(stalePassAdvisory((await migration(fresh)).nextSteps)).toEqual([]);
  });

  it('should write the dependent task output glob the generators write', async () => {
    await generateWorkspace(tree);
    await revertToPreFix(tree);

    await migration(tree);

    expect(readNxJson(tree).namedInputs.default).toContainEqual(
      DEPENDENT_TASKS_OUTPUT_FILES_INPUT,
    );
  });
});
