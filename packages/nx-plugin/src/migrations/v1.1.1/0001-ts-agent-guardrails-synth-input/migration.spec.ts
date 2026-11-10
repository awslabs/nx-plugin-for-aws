/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  getProjects,
  readJson,
  type Tree,
  updateJson,
  writeJson,
} from '@nx/devkit';
import {
  INFRA_APP_GENERATOR_INFO,
  tsInfraGenerator,
} from '../../../infra/app/generator.js';
import { tsAgentGenerator } from '../../../ts/agent/generator.js';
import {
  TS_AGENT_GUARDRAILS_GENERATOR_INFO,
  tsAgentGuardrailsGenerator,
} from '../../../ts/agent/guardrails/generator.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import migration from './migration.js';

const INFRA_PROJECT_JSON = 'packages/infra/project.json';
const policyInput = (agentDir: string) =>
  `{workspaceRoot}/${agentDir}/guardrail.json`;

describe('ts-agent-guardrails-synth-input migration', () => {
  let tree: Tree;

  const addHostProject = (name: string) => {
    addProjectConfiguration(tree, name, {
      root: `apps/${name}`,
      sourceRoot: `apps/${name}/src`,
      targets: {},
    });
    writeJson(tree, `apps/${name}/tsconfig.json`, {});
    writeJson(tree, `apps/${name}/package.json`, {
      name,
      version: '1.0.0',
    });
  };

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    addHostProject('test-project');
    tree.write('aws-nx-plugin.config.mts', 'export default {};\n');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const addInfra = (name = 'infra') =>
    tsInfraGenerator(tree, {
      name,
      directory: 'packages',
      preferInstallDependencies: false,
    });

  const addAgent = (
    options: {
      project?: string;
      name?: string;
      iac?: 'cdk' | 'terraform';
    } = {},
  ) =>
    tsAgentGenerator(tree, {
      project: options.project ?? 'test-project',
      name: options.name,
      infra: 'agentcore',
      iac: options.iac ?? 'cdk',
      preferInstallDependencies: false,
    });

  const guard = (agent?: string, project = 'test-project') =>
    tsAgentGuardrailsGenerator(tree, { project, agent });

  const generateWorkspace = async () => {
    await addInfra();
    await addAgent();
    await guard();
  };

  const infraRoots = () =>
    [...getProjects(tree).values()]
      .filter((p) => p.metadata?.generator === INFRA_APP_GENERATOR_INFO.id)
      .map((p) => p.root);

  // Fixture edits below are formatted before the comparison, since the
  // migration formats every file changed in the tree.

  // The infrastructure as @aws/nx-plugin 1.1.0 generates it, whose synth
  // inputs do not list guardrail.json.
  const toReleasedShape = () => {
    for (const root of infraRoots()) {
      updateJson(tree, `${root}/project.json`, (config) => {
        config.targets.synth.inputs = ['default'];
        return config;
      });
    }
  };

  const snapshotFiles = (): Record<string, string> =>
    Object.fromEntries(
      tree
        .listChanges()
        .filter((c) => c.type !== 'DELETE')
        .map((c) => [c.path, tree.read(c.path, 'utf-8') ?? '']),
    );

  const synthInputs = (root = 'packages/infra') =>
    readJson(tree, `${root}/project.json`).targets.synth.inputs;

  it('converges on what the generator writes today', async () => {
    await generateWorkspace();
    const generated = tree.read(INFRA_PROJECT_JSON, 'utf-8');
    toReleasedShape();
    expect(tree.read(INFRA_PROJECT_JSON, 'utf-8')).not.toEqual(generated);

    await migration(tree);

    expect(tree.read(INFRA_PROJECT_JSON, 'utf-8')).toEqual(generated);
  });

  it('is a no-op on a freshly generated workspace', async () => {
    await generateWorkspace();
    const before = snapshotFiles();

    const { nextSteps } = await migration(tree);

    expect(snapshotFiles()).toEqual(before);
    expect(nextSteps).toEqual([]);
  });

  it('is idempotent', async () => {
    await generateWorkspace();
    toReleasedShape();
    await migration(tree);
    const once = snapshotFiles();

    const { nextSteps } = await migration(tree);

    expect(snapshotFiles()).toEqual(once);
    expect(nextSteps).toEqual([]);
  });

  it('handles several guarded agents and several infrastructure projects', async () => {
    addHostProject('second-project');
    await addInfra();
    await addInfra('infra-two');
    await addAgent({ name: 'my-agent' });
    await addAgent({ name: 'other-agent' });
    await addAgent({ project: 'second-project' });
    await guard('my-agent');
    await guard('other-agent');
    await guard(undefined, 'second-project');
    toReleasedShape();

    await migration(tree);

    const expected = [
      'default',
      policyInput('apps/test-project/src/my-agent'),
      policyInput('apps/test-project/src/other-agent'),
      policyInput('apps/second-project/src/agent'),
    ];
    expect(synthInputs()).toEqual(expect.arrayContaining(expected));
    expect(synthInputs()).toHaveLength(expected.length);
    expect(synthInputs('packages/infra-two')).toEqual(
      expect.arrayContaining(expected),
    );
    expect(synthInputs('packages/infra-two')).toHaveLength(expected.length);
  });

  it('reports an infrastructure project whose synth has no inputs, or no synth', async () => {
    await addInfra();
    await addInfra('infra-two');
    await addAgent();
    await guard();
    updateJson(tree, INFRA_PROJECT_JSON, (config) => {
      delete config.targets.synth.inputs;
      return config;
    });
    updateJson(tree, 'packages/infra-two/project.json', (config) => {
      delete config.targets.synth;
      return config;
    });
    await formatFilesInSubtree(tree);
    const infra = tree.read(INFRA_PROJECT_JSON, 'utf-8');
    const infraTwo = tree.read('packages/infra-two/project.json', 'utf-8');

    const { nextSteps } = await migration(tree);

    expect(tree.read(INFRA_PROJECT_JSON, 'utf-8')).toEqual(infra);
    expect(tree.read('packages/infra-two/project.json', 'utf-8')).toEqual(
      infraTwo,
    );
    expect(nextSteps).toHaveLength(2);
    const entry = policyInput('apps/test-project/src/agent');
    expect(nextSteps).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^@proj\/infra: .*has no inputs.*/),
        expect.stringMatching(/^@proj\/infra-two: .*has no synth target.*/),
      ]),
    );
    for (const step of nextSteps) {
      expect(step).toContain(entry);
    }
  });

  it('is a no-op without guarded agents', async () => {
    await addInfra();
    await addAgent();
    const before = snapshotFiles();

    const { nextSteps } = await migration(tree);

    expect(snapshotFiles()).toEqual(before);
    expect(nextSteps).toEqual([]);
  });

  it('ignores Terraform guardrails and guardrails without a matching ts#agent', async () => {
    await addInfra();
    await addAgent({ iac: 'terraform' });
    await guard();
    updateJson(tree, 'apps/test-project/project.json', (config) => {
      config.metadata.components.push({
        generator: TS_AGENT_GUARDRAILS_GENERATOR_INFO.id,
        name: 'ghost',
        path: 'src/ghost',
      });
      return config;
    });
    await formatFilesInSubtree(tree);
    const before = snapshotFiles();

    const { nextSteps } = await migration(tree);

    expect(snapshotFiles()).toEqual(before);
    expect(synthInputs()).toEqual(['default']);
    expect(nextSteps).toEqual([]);
  });

  it('ignores projects not generated by ts#infra', async () => {
    await addAgent();
    await guard();
    addProjectConfiguration(tree, 'other', {
      root: 'packages/other',
      metadata: { generator: 'ts#project' } as any,
      targets: {
        synth: { command: 'cdk synth', inputs: ['default'] },
      },
    });
    await formatFilesInSubtree(tree);
    const before = snapshotFiles();

    const { nextSteps } = await migration(tree);

    expect(snapshotFiles()).toEqual(before);
    expect(
      readJson(tree, 'packages/other/project.json').targets.synth.inputs,
    ).toEqual(['default']);
    expect(nextSteps).toEqual([]);
  });
});
