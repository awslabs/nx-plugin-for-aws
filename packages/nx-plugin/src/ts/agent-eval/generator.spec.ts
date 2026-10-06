/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readProjectConfiguration,
  type Tree,
  writeJson,
} from '@nx/devkit';
import { declareDependencies } from '../../utils/declared-dependencies.js';
import { expectHasMetricTags } from '../../utils/metrics-assertions.js';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../../utils/shared-constructs.js';
import { createTreeUsingTsSolutionSetup } from '../../utils/test.js';
import { tsAgentGenerator } from '../agent/generator.js';
import {
  TS_AGENT_EVAL_GENERATOR_INFO,
  tsAgentEvalGenerator,
} from './generator.js';

describe('ts#agent-eval generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();

    addProjectConfiguration(tree, 'test-project', {
      root: 'apps/test-project',
      sourceRoot: 'apps/test-project/src',
      targets: {},
    });
    writeJson(tree, 'apps/test-project/tsconfig.json', {});
    writeJson(tree, 'apps/test-project/package.json', {
      name: 'test-project',
      version: '1.0.0',
    });
    tree.write('aws-nx-plugin.config.mts', 'export default {};\n');
  });

  const addAgent = (name?: string) =>
    tsAgentGenerator(tree, {
      project: 'test-project',
      name,
      infra: 'none',
      session: 'in-memory',
      iac: 'cdk',
    });

  it('should add the eval runner, cases and target for the default agent', async () => {
    await addAgent();

    await tsAgentEvalGenerator(tree, { project: 'test-project' });

    expect(
      tree.read('apps/test-project/scripts/agent/eval.ts', 'utf-8'),
    ).toMatchSnapshot('eval.ts');
    expect(
      tree.read('apps/test-project/evals/agent/cases.json', 'utf-8'),
    ).toMatchSnapshot('cases.json');

    const project = readProjectConfiguration(tree, 'test-project');
    expect(project.targets['agent-eval']).toEqual({
      executor: 'nx:run-commands',
      options: {
        commands: ['tsx ./scripts/agent/eval.ts'],
        cwd: '{projectRoot}',
        env: { LOCAL_DEV: 'true' },
      },
    });
    expect(project.metadata.components).toContainEqual({
      generator: TS_AGENT_EVAL_GENERATOR_INFO.id,
      path: 'evals/agent',
      name: 'agent',
    });
  });

  it('should evaluate the named agent when the project has several', async () => {
    await addAgent();
    await addAgent('my-agent');

    await tsAgentEvalGenerator(tree, {
      project: 'test-project',
      agent: 'my-agent',
    });

    const evalScript = tree.read(
      'apps/test-project/scripts/my-agent/eval.ts',
      'utf-8',
    );
    expect(evalScript).toContain(
      "import { getAgent } from '../../src/my-agent/agent.js';",
    );
    expect(evalScript).toContain("'evals/my-agent/cases.json'");
    expect(evalScript).toContain('MyAgent');
    expect(
      tree.exists('apps/test-project/evals/my-agent/cases.json'),
    ).toBeTruthy();
    expect(tree.exists('apps/test-project/scripts/agent/eval.ts')).toBeFalsy();

    const project = readProjectConfiguration(tree, 'test-project');
    expect(project.targets['my-agent-eval'].options.commands).toEqual([
      'tsx ./scripts/my-agent/eval.ts',
    ]);
    expect(project.targets['agent-eval']).toBeUndefined();
  });

  it('should import the session scope from the agent-connection package', async () => {
    await addAgent();

    await tsAgentEvalGenerator(tree, { project: 'test-project' });

    expect(
      tree.read('apps/test-project/scripts/agent/eval.ts', 'utf-8'),
    ).toContain("import { runWithSessionId } from '@proj/agent-connection';");
  });

  it('should throw when the project has no TypeScript agent', async () => {
    await expect(
      tsAgentEvalGenerator(tree, { project: 'test-project' }),
    ).rejects.toThrow('Project test-project has no TypeScript Agent');
  });

  it('should throw when the project has several agents and none is named', async () => {
    await addAgent();
    await addAgent('my-agent');

    await expect(
      tsAgentEvalGenerator(tree, { project: 'test-project' }),
    ).rejects.toThrow(
      'Project test-project has more than one TypeScript Agent. Specify which to evaluate with --agent. Available agents: agent, my-agent',
    );
  });

  it('should throw when the named agent does not exist', async () => {
    await addAgent();

    await expect(
      tsAgentEvalGenerator(tree, { project: 'test-project', agent: 'missing' }),
    ).rejects.toThrow(
      'No TypeScript Agent named missing in project test-project. Available agents: agent',
    );
  });

  it('should be idempotent and keep edited cases when re-run', async () => {
    await addAgent();
    await tsAgentEvalGenerator(tree, { project: 'test-project' });

    const editedCases = '{ "cases": [] }\n';
    tree.write('apps/test-project/evals/agent/cases.json', editedCases);
    const projectJson = tree.read('apps/test-project/project.json', 'utf-8');
    const evalScript = tree.read(
      'apps/test-project/scripts/agent/eval.ts',
      'utf-8',
    );

    await tsAgentEvalGenerator(tree, { project: 'test-project' });

    expect(tree.read('apps/test-project/evals/agent/cases.json', 'utf-8')).toBe(
      editedCases,
    );
    expect(tree.read('apps/test-project/project.json', 'utf-8')).toBe(
      projectJson,
    );
    expect(tree.read('apps/test-project/scripts/agent/eval.ts', 'utf-8')).toBe(
      evalScript,
    );
  });

  it('should add generator metric to app.ts', async () => {
    await sharedConstructsGenerator(
      tree,
      { iac: 'cdk' },
      declareDependencies()({ ts: [...SHARED_CONSTRUCTS_DEPENDENCIES] }),
    );
    await addAgent();

    await tsAgentEvalGenerator(tree, { project: 'test-project' });

    expectHasMetricTags(tree, TS_AGENT_EVAL_GENERATOR_INFO.metric);
  });
});
