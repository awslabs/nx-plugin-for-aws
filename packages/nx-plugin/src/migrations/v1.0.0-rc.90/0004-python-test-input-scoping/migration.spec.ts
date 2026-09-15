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

  it('should exclude only test reports from the dependent task output input', async () => {
    await migration(tree);

    expect(dependentTasksGlob(tree)).toBe('!{reports,coverage}/**');
    // The rest of the `default` input is left as it was.
    expect(readNxJson(tree)?.namedInputs?.default).toEqual([
      '{projectRoot}/**/*',
      'sharedGlobals',
      { dependentTasksOutputFiles: '!{reports,coverage}/**', transitive: true },
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

    it('should not rescope a user-authored target that merely shares the -openapi suffix', async () => {
      addProjectConfiguration(
        tree,
        'proj.py_api',
        pythonProject({
          targets: {
            compile: {
              executor: '@nxlv/python:build',
              inputs: ['default', '^production'],
            },
            // Not the vended shape: a different executor, and it writes
            // somewhere other than an `openapi` dir.
            'my-fixtures-openapi': {
              executor: '@nxlv/python:run-commands',
              outputs: ['{workspaceRoot}/dist/{projectRoot}/fixtures'],
            },
          },
        }),
      );

      await migration(tree);

      expect(
        readProjectConfiguration(tree, 'proj.py_api').targets[
          'my-fixtures-openapi'
        ].inputs,
      ).toBeUndefined();
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

    it('should create the production named input when absent, so rescoped targets stay valid', async () => {
      // The plain Nx default: no `namedInputs` at all. Nx fails hard on a target
      // that references an undefined named input, so the migration must not
      // rescope targets to `production` without also defining it.
      updateNxJson(tree, { ...readNxJson(tree), namedInputs: undefined });
      addProjectConfiguration(tree, 'proj.py_api', pythonProject());

      const result = await migration(tree);

      expect(readNxJson(tree)?.namedInputs?.production).toEqual([
        'default',
        ...PYTHON_TEST_FILE_EXCLUSIONS,
      ]);
      expect(
        readProjectConfiguration(tree, 'proj.py_api').targets.compile.inputs,
      ).toEqual(['production', '^production']);
      expect(result.nextSteps).toEqual([]);
    });

    it('should not rescope a target to an undefined named input', async () => {
      // Guards the invariant directly: whenever any target ends up reading
      // `production`, `production` must exist in nx.json.
      updateNxJson(tree, { ...readNxJson(tree), namedInputs: undefined });
      addProjectConfiguration(tree, 'proj.py_api', pythonProject());

      await migration(tree);

      const namedInputs = readNxJson(tree)?.namedInputs ?? {};
      const targets = readProjectConfiguration(tree, 'proj.py_api').targets;
      const referencesProduction = Object.values(targets).some((target) =>
        (target.inputs ?? []).some(
          (input) => input === 'production' || input === '^production',
        ),
      );
      expect(referencesProduction).toBe(true);
      expect(namedInputs.production).toBeDefined();
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
