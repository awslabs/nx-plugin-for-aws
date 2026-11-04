/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { parse, stringify } from '@iarna/toml';
import { addProjectConfiguration, getProjects, type Tree } from '@nx/devkit';
import { parsePipRequirementsLine } from 'pip-requirements-js';
import { pyAgentGenerator } from '../../../py/agent/generator.js';
import { pyProjectGenerator } from '../../../py/project/generator.js';
import type { UVPyprojectToml } from '../../../utils/nxlv-python.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { PY_VERSIONS } from '../../../utils/versions.js';
import migration from './migration.js';

const ROOT = 'pyproject.toml';
// The override this migration wrote when it shipped in v1.0.15. Pinned here
// because the generators no longer write it.
const expected = ['pillow>=13.0.0'];
const [override] = expected;
const overridden = parsePipRequirementsLine(override);
const overriddenName =
  overridden?.type === 'ProjectName' ? overridden.name : '';
const strandsTools = `strands-agents-tools${PY_VERSIONS['strands-agents-tools']}`;

describe('py-agent-pillow-override migration', () => {
  let tree: Tree;

  const rootText = () => tree.read(ROOT, 'utf-8');
  const readRoot = () => parse(rootText()) as UVPyprojectToml;

  const generateWorkspace = async (
    framework: 'strands' | 'langchain' = 'strands',
  ) => {
    await pyProjectGenerator(tree, {
      name: 'py_project',
      directory: 'packages',
      type: 'application',
    });
    const [project] = [...getProjects(tree)].find(
      ([, config]) => config.root === 'packages/py_project',
    );
    await pyAgentGenerator(tree, {
      project,
      framework,
      infra: 'none',
      iac: 'cdk',
    });
  };

  // Set the root override-dependencies, or remove them. The generators write
  // none, as @aws/nx-plugin 1.0.14 did; 1.0.15 up to the pillow lift wrote
  // `expected`.
  const setRootOverrides = (overrides?: string[]) => {
    const toml = readRoot();
    delete toml.tool.uv['override-dependencies'];
    if (overrides) {
      toml.tool.uv['override-dependencies'] = overrides;
    }
    tree.write(ROOT, stringify(toml as any));
  };

  const writeRoot = () =>
    tree.write(
      ROOT,
      stringify({
        project: { name: 'proj', version: '0.1.0', dependencies: [] },
        tool: {
          uv: { workspace: { members: ['packages/a', 'packages/b'] } },
        },
      } as any),
    );

  const addPyProject = (name: string, content: string) => {
    addProjectConfiguration(tree, name, { root: `packages/${name}` });
    tree.write(`packages/${name}/pyproject.toml`, content);
  };

  const pyproject = (name: string, dependencies: string[]) =>
    stringify({
      project: { name, version: '0.1.0', dependencies },
    } as any);

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  it('should converge on what the generator wrote in v1.0.15', async () => {
    await generateWorkspace();
    expect(readRoot().tool.uv['override-dependencies']).toBeUndefined();
    setRootOverrides(expected);
    const shipped = rootText();
    setRootOverrides();

    const { nextSteps } = await migration(tree);

    expect(rootText()).toBe(shipped);
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain('uv sync');
  });

  it('should be a no-op on a workspace that already has the override', async () => {
    await generateWorkspace();
    setRootOverrides(expected);
    const before = rootText();

    const { nextSteps } = await migration(tree);

    expect(rootText()).toBe(before);
    expect(nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    await generateWorkspace();
    await migration(tree);
    const afterFirst = tree
      .listChanges()
      .map((c) => [c.path, c.content?.toString()]);

    const { nextSteps } = await migration(tree);

    expect(
      tree.listChanges().map((c) => [c.path, c.content?.toString()]),
    ).toEqual(afterFirst);
    expect(nextSteps).toEqual([]);
  });

  it('should merge with an existing user override list', async () => {
    await generateWorkspace();
    setRootOverrides(['urllib3>=2.5.0']);

    await migration(tree);

    expect(readRoot().tool.uv['override-dependencies']).toEqual([
      'urllib3>=2.5.0',
      ...expected,
    ]);
  });

  it('should leave a user override for the same package alone', async () => {
    await generateWorkspace();
    setRootOverrides([`${overriddenName}==12.2.0`]);
    const before = rootText();

    const { nextSteps } = await migration(tree);

    expect(rootText()).toBe(before);
    expect(nextSteps).toEqual([]);
  });

  it.each([
    strandsTools,
    `Strands_Agents_Tools${PY_VERSIONS['strands-agents-tools']}`,
  ])('should detect %s in any member project', async (dependency) => {
    writeRoot();
    addPyProject('a', pyproject('a', [`fastapi${PY_VERSIONS.fastapi}`]));
    addPyProject('b', pyproject('b', [dependency]));

    await migration(tree);

    expect(readRoot().tool.uv['override-dependencies']).toEqual(expected);
  });

  it('should leave an override-dependencies that is not a list alone', async () => {
    await generateWorkspace();
    const toml = readRoot();
    (toml.tool.uv as Record<string, unknown>)['override-dependencies'] =
      'not-a-list';
    tree.write(ROOT, stringify(toml as any));
    const before = rootText();

    const { nextSteps } = await migration(tree);

    expect(rootText()).toBe(before);
    expect(nextSteps).toEqual([]);
  });

  it('should be a no-op without a root pyproject.toml', async () => {
    addPyProject('a', pyproject('a', [strandsTools]));

    const { nextSteps } = await migration(tree);

    expect(tree.exists(ROOT)).toBe(false);
    expect(nextSteps).toEqual([]);
  });

  it('should be a no-op without strands-agents-tools', async () => {
    await generateWorkspace('langchain');
    const before = rootText();

    const { nextSteps } = await migration(tree);

    expect(rootText()).toBe(before);
    expect(nextSteps).toEqual([]);
  });

  it('should ignore projects with no or an unparsable pyproject.toml', async () => {
    writeRoot();
    addProjectConfiguration(tree, 'ts-project', { root: 'packages/ts' });
    addPyProject('a', '[project\nname = ');
    addPyProject('b', pyproject('b', [strandsTools]));

    await migration(tree);

    expect(readRoot().tool.uv['override-dependencies']).toEqual(expected);
  });
});
