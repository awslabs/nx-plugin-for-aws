/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  type ProjectConfiguration,
  readNxJson,
  readProjectConfiguration,
  type Tree,
  updateNxJson,
} from '@nx/devkit';
import { PYTHON_TEST_FILE_EXCLUSIONS } from '../../../py/project/generator';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test';
import migration from './migration';

/** The named inputs a pre-migration workspace carries. */
const PREVIOUS_NAMED_INPUTS = {
  default: [
    '{projectRoot}/**/*',
    'sharedGlobals',
    { dependentTasksOutputFiles: '**/*', transitive: true },
  ],
  production: [
    'default',
    '!{projectRoot}/**/?(*.)+(spec|test).[jt]s?(x)?(.snap)',
    '!{projectRoot}/tsconfig.spec.json',
    '!{projectRoot}/src/test-setup.[jt]s',
  ],
  sharedGlobals: [],
};

/** A Python project as the generators vended it before this change. */
const pythonProject = (
  overrides: Partial<ProjectConfiguration> = {},
): ProjectConfiguration => ({
  root: 'packages/py_api',
  name: 'proj.py_api',
  targets: {
    compile: {
      executor: '@nxlv/python:build',
      inputs: ['default', '^production'],
      outputs: ['{workspaceRoot}/dist/{projectRoot}/build'],
    },
    'bundle-x86': {
      executor: 'nx:run-commands',
      inputs: ['default', '^production'],
      outputs: ['{workspaceRoot}/dist/{projectRoot}/bundle-x86'],
    },
    openapi: {
      executor: 'nx:run-commands',
      outputs: ['{workspaceRoot}/dist/{projectRoot}/openapi'],
    },
    typecheck: {
      executor: '@nxlv/python:run-commands',
      inputs: ['default', '^production'],
    },
    test: {
      executor: '@nxlv/python:run-commands',
      outputs: ['{workspaceRoot}/reports/{projectRoot}/unittests'],
    },
  },
  ...overrides,
});

const setUpWorkspace = (tree: Tree) => {
  updateNxJson(tree, {
    ...readNxJson(tree),
    namedInputs: structuredClone(PREVIOUS_NAMED_INPUTS),
  });
};

const dependentTasksGlob = (tree: Tree) => {
  const defaultInput = readNxJson(tree)?.namedInputs?.default ?? [];
  const entry = defaultInput.find(
    (input) =>
      typeof input === 'object' &&
      input !== null &&
      'dependentTasksOutputFiles' in input,
  );
  return (entry as { dependentTasksOutputFiles?: string } | undefined)
    ?.dependentTasksOutputFiles;
};

describe('python-test-input-scoping migration', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    setUpWorkspace(tree);
  });

  it('should exclude python test files from the production named input', async () => {
    await migration(tree);

    expect(readNxJson(tree)?.namedInputs?.production).toEqual([
      ...PREVIOUS_NAMED_INPUTS.production,
      ...PYTHON_TEST_FILE_EXCLUSIONS,
    ]);
  });

  it('should scope the dependent task output input to dist', async () => {
    await migration(tree);

    expect(dependentTasksGlob(tree)).toBe('dist/**');
    // The rest of the `default` input is left as it was.
    expect(readNxJson(tree)?.namedInputs?.default).toEqual([
      '{projectRoot}/**/*',
      'sharedGlobals',
      { dependentTasksOutputFiles: 'dist/**', transitive: true },
    ]);
  });

  it('should scope python build chain targets to production inputs', async () => {
    addProjectConfiguration(tree, 'proj.py_api', pythonProject());

    await migration(tree);

    const project = readProjectConfiguration(tree, 'proj.py_api');
    expect(project.targets.compile.inputs).toEqual([
      'production',
      '^production',
    ]);
    expect(project.targets['bundle-x86'].inputs).toEqual([
      'production',
      '^production',
    ]);
    expect(project.targets.openapi.inputs).toEqual([
      'production',
      '^production',
    ]);
  });

  it('should leave typecheck on default inputs since ty checks the tests directory', async () => {
    addProjectConfiguration(tree, 'proj.py_api', pythonProject());

    await migration(tree);

    expect(
      readProjectConfiguration(tree, 'proj.py_api').targets.typecheck.inputs,
    ).toEqual(['default', '^production']);
  });

  it('should scope agent openapi targets', async () => {
    addProjectConfiguration(
      tree,
      'proj.py_lib',
      pythonProject({
        root: 'packages/py_lib',
        name: 'proj.py_lib',
        targets: {
          compile: {
            executor: '@nxlv/python:build',
            inputs: ['default', '^production'],
          },
          'agent-openapi': {
            executor: 'nx:run-commands',
            outputs: ['{workspaceRoot}/dist/{projectRoot}/openapi/agent'],
          },
        },
      }),
    );

    await migration(tree);

    expect(
      readProjectConfiguration(tree, 'proj.py_lib').targets['agent-openapi']
        .inputs,
    ).toEqual(['production', '^production']);
  });

  it('should not touch non-python projects', async () => {
    const tsProject: ProjectConfiguration = {
      root: 'packages/ts-lib',
      name: '@proj/ts-lib',
      targets: {
        compile: {
          executor: 'nx:run-commands',
          inputs: ['default', '^production'],
        },
      },
    };
    addProjectConfiguration(tree, '@proj/ts-lib', tsProject);

    await migration(tree);

    expect(
      readProjectConfiguration(tree, '@proj/ts-lib').targets.compile.inputs,
    ).toEqual(['default', '^production']);
  });

  describe('preserving user customisations', () => {
    it('should preserve existing production entries', async () => {
      updateNxJson(tree, {
        ...readNxJson(tree),
        namedInputs: {
          ...PREVIOUS_NAMED_INPUTS,
          production: ['default', '!{projectRoot}/my-fixtures/**/*'],
        },
      });

      await migration(tree);

      expect(readNxJson(tree)?.namedInputs?.production).toEqual([
        'default',
        '!{projectRoot}/my-fixtures/**/*',
        ...PYTHON_TEST_FILE_EXCLUSIONS,
      ]);
    });

    it('should report rather than replace a customised dependent task output glob', async () => {
      updateNxJson(tree, {
        ...readNxJson(tree),
        namedInputs: {
          ...PREVIOUS_NAMED_INPUTS,
          default: [
            '{projectRoot}/**/*',
            { dependentTasksOutputFiles: 'build/**', transitive: true },
          ],
        },
      });

      const result = await migration(tree);

      expect(dependentTasksGlob(tree)).toBe('build/**');
      expect(result.nextSteps).toEqual(
        expect.arrayContaining([expect.stringContaining('custom glob')]),
      );
    });

    it('should report rather than replace customised target inputs', async () => {
      addProjectConfiguration(
        tree,
        'proj.py_api',
        pythonProject({
          targets: {
            compile: {
              executor: '@nxlv/python:build',
              inputs: ['default', '^production', '{workspaceRoot}/extra.txt'],
            },
          },
        }),
      );

      const result = await migration(tree);

      expect(
        readProjectConfiguration(tree, 'proj.py_api').targets.compile.inputs,
      ).toEqual(['default', '^production', '{workspaceRoot}/extra.txt']);
      expect(result.nextSteps).toEqual(
        expect.arrayContaining([
          expect.stringContaining('proj.py_api:compile'),
        ]),
      );
    });

    it('should report a workspace with no production named input', async () => {
      updateNxJson(tree, {
        ...readNxJson(tree),
        namedInputs: { default: PREVIOUS_NAMED_INPUTS.default },
      });

      const result = await migration(tree);

      expect(readNxJson(tree)?.namedInputs?.production).toBeUndefined();
      expect(result.nextSteps).toEqual(
        expect.arrayContaining([
          expect.stringContaining("declares no 'production' named input"),
        ]),
      );
    });
  });

  it('should be idempotent', async () => {
    addProjectConfiguration(tree, 'proj.py_api', pythonProject());

    await migration(tree);
    const nxJsonAfterFirstRun = tree.read('nx.json')!.toString();
    const projectAfterFirstRun = tree
      .read('packages/py_api/project.json')!
      .toString();

    const result = await migration(tree);

    expect(tree.read('nx.json')!.toString()).toBe(nxJsonAfterFirstRun);
    expect(tree.read('packages/py_api/project.json')!.toString()).toBe(
      projectAfterFirstRun,
    );
    expect(result.nextSteps).toEqual([]);
  });
});
