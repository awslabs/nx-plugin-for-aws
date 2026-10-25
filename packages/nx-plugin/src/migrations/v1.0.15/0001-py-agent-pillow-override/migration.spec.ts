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
import { PY_UV_OVERRIDES, PY_VERSIONS } from '../../../utils/versions.js';
import migration from './migration.js';

const ROOT = 'pyproject.toml';
const expected = [...PY_UV_OVERRIDES['strands-agents-tools']];
const [override] = PY_UV_OVERRIDES['strands-agents-tools'];
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

  // The root pyproject.toml as @aws/nx-plugin 1.0.14 generates it, which has
  // no override-dependencies.
  const toReleasedShape = (userOverrides?: string[]) => {
    const toml = readRoot();
    delete toml.tool.uv['override-dependencies'];
    if (userOverrides) {
      toml.tool.uv['override-dependencies'] = userOverrides;
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

  it('should converge on what the generator writes today', async () => {
    await generateWorkspace();
    const generated = rootText();
    toReleasedShape();
    expect(rootText()).not.toBe(generated);

    const { nextSteps } = await migration(tree);

    expect(rootText()).toBe(generated);
    expect(nextSteps).toHaveLength(1);
    expect(nextSteps[0]).toContain('uv sync');
  });

  it('should be a no-op on a freshly generated workspace', async () => {
    await generateWorkspace();
    const generated = rootText();

    const { nextSteps } = await migration(tree);

    expect(rootText()).toBe(generated);
    expect(nextSteps).toEqual([]);
  });

  it('should be idempotent', async () => {
    await generateWorkspace();
    toReleasedShape();
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
    toReleasedShape(['urllib3>=2.5.0']);

    await migration(tree);

    expect(readRoot().tool.uv['override-dependencies']).toEqual([
      'urllib3>=2.5.0',
      ...expected,
    ]);
  });

  it('should leave a user override for the same package alone', async () => {
    await generateWorkspace();
    toReleasedShape([`${overriddenName}==12.2.0`]);
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
