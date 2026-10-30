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
import ts from 'typescript';
import { pyAgentGenerator } from '../../py/agent/generator.js';
import { expectHasMetricTags } from '../../utils/metrics-assertions.js';
import { createTreeUsingTsSolutionSetup } from '../../utils/test.js';
import {
  OBSERVABILITY_LANGFUSE_GENERATOR_INFO,
  observabilityLangfuseGenerator,
} from './generator.js';

const ROOT = 'apps/test-project';
const MODULE = `${ROOT}/test_project`;
const AGENT = `${MODULE}/agent`;
const CONSTRUCT =
  'packages/common/constructs/src/app/agents/test-project-agent/test-project-agent.ts';
const CONFIG =
  'packages/common/constructs/src/app/agents/test-project-agent/langfuse-observability.ts';
const SECRET =
  'arn:aws:secretsmanager:us-east-1:123456789012:secret:langfuse-abcdef';
const options = {
  project: 'test-project',
  secretArn: SECRET,
  preferInstallDependencies: false,
};
const files = (tree: Tree) =>
  Object.fromEntries(
    tree
      .listChanges()
      .map((change) => [change.path, change.content?.toString() ?? null]),
  );

describe('observability#langfuse generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tree, 'test-project', {
      root: ROOT,
      sourceRoot: MODULE,
      targets: {
        build: {
          executor: '@nxlv/python:build',
          options: { outputPath: `dist/${ROOT}` },
        },
      },
    });
    tree.write(
      `${ROOT}/pyproject.toml`,
      '[project]\nname = "test.project"\nversion = "0.1.0"\ndependencies = []\n\n[dependency-groups]\ndev = []\n',
    );
    tree.write('aws-nx-plugin.config.mts', 'export default {};\n');
  });

  const addAgent = (name?: string, session: 's3' | 'in-memory' = 'in-memory') =>
    pyAgentGenerator(tree, {
      project: 'test-project',
      name,
      session,
      framework: 'strands',
      protocol: 'http',
      infra: 'agentcore',
      iac: 'cdk',
      auth: 'iam',
      preferInstallDependencies: false,
    });

  it('requires an existing Python agent', async () => {
    await expect(observabilityLangfuseGenerator(tree, options)).rejects.toThrow(
      'run py#agent first',
    );
  });

  it.each(['s3', 'in-memory'] as const)(
    'wires only the selected agent with %s sessions',
    async (session) => {
      await addAgent(undefined, session);
      const model = tree.read(`${AGENT}/agent.py`, 'utf-8');
      const stock = tree.read(`${ROOT}/package/agent/main.py`, 'utf-8');
      await observabilityLangfuseGenerator(tree, options);
      expect(tree.read(`${AGENT}/agent.py`, 'utf-8')).toBe(model);
      expect(tree.read(`${ROOT}/package/agent/main.py`, 'utf-8')).toBe(stock);
      expect(tree.read(CONSTRUCT, 'utf-8')).toContain(
        'entrypoint: langfuseObservability.entrypoint',
      );
      expect(tree.read(CONSTRUCT, 'utf-8')).toContain(
        '...langfuseObservability.environmentVariables',
      );
      expect(tree.read(CONSTRUCT, 'utf-8')).toContain(
        'configureLangfuseRuntime(this.agentCoreRuntime)',
      );
      expect(tree.read(`${AGENT}/init.py`, 'utf-8')).toContain(
        '**langfuse_fastapi_options()',
      );
      const config = tree.read(CONFIG, 'utf-8');
      expect(config).toContain(SECRET);
      expect(config).toContain("actions: ['secretsmanager:GetSecretValue']");
      expect(config).not.toContain('LANGFUSE_PUBLIC_KEY');
      expect(config).not.toContain('LANGFUSE_SECRET_KEY');
      expect(config).not.toContain("resources: ['*']");
      expect.soft(config).toMatchSnapshot('Langfuse config');
      const construct = tree.read(CONSTRUCT, 'utf-8');
      const parsed = ts.createSourceFile(
        CONSTRUCT,
        construct,
        ts.ScriptTarget.Latest,
      );
      expect(
        (parsed as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] })
          .parseDiagnostics,
      ).toEqual([]);
      expect.soft(construct).toMatchSnapshot('wired construct');
      expectHasMetricTags(tree, OBSERVABILITY_LANGFUSE_GENERATOR_INFO.metric);
    },
  );

  it('is a byte-for-byte no-op when retaining CloudWatch on an untouched agent', async () => {
    await addAgent();
    const before = files(tree);
    await observabilityLangfuseGenerator(tree, {
      project: options.project,
      mode: 'cloudwatch',
    });
    expect(files(tree)).toEqual(before);
    expect(tree.read(`${AGENT}/init.py`, 'utf-8')).not.toContain('langfuse');
  });

  it('is idempotent and preserves user edits', async () => {
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);
    tree.write(
      `${AGENT}/langfuse_telemetry.py`,
      `${tree.read(`${AGENT}/langfuse_telemetry.py`, 'utf-8')}\n# Custom exporter adjustment\n`,
    );
    const before = files(tree);
    await observabilityLangfuseGenerator(tree, options);
    expect(files(tree)).toEqual(before);
    const components = readProjectConfiguration(tree, options.project).metadata
      .components as { generator: string }[];
    expect(
      components.filter(
        (component) =>
          component.generator === OBSERVABILITY_LANGFUSE_GENERATOR_INFO.id,
      ),
    ).toHaveLength(1);
  });

  it('switches to CloudWatch and back without duplicate wiring', async () => {
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);
    const construct = tree.read(CONSTRUCT, 'utf-8');
    await observabilityLangfuseGenerator(tree, {
      project: options.project,
      mode: 'cloudwatch',
      preferInstallDependencies: false,
    });
    expect(tree.read(CONFIG, 'utf-8')).toContain('agentcore_launcher.py');
    expect(tree.read(CONFIG, 'utf-8')).not.toContain(
      'secretsmanager:GetSecretValue',
    );
    expect(tree.read(CONFIG, 'utf-8')).not.toContain(
      'DISABLE_ADOT_OBSERVABILITY',
    );
    expect(tree.read(CONFIG, 'utf-8')).toMatchSnapshot('CloudWatch config');
    const disabled = files(tree);
    await observabilityLangfuseGenerator(tree, {
      project: options.project,
      mode: 'cloudwatch',
    });
    expect(files(tree)).toEqual(disabled);
    await observabilityLangfuseGenerator(tree, {
      project: options.project,
      preferInstallDependencies: false,
    });
    expect(tree.read(CONFIG, 'utf-8')).toContain(SECRET);
    expect(tree.read(CONSTRUCT, 'utf-8')).toBe(construct);
  });

  it('restores packaging after re-running the agent generator', async () => {
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);
    const before = files(tree);
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);
    expect(files(tree)).toEqual(before);
  });

  it('leaves unrelated environment maps unchanged', async () => {
    await addAgent();
    const custom =
      "\nexport const custom = { environmentVariables: { CUSTOM: 'value' } };\n";
    tree.write(CONSTRUCT, tree.read(CONSTRUCT, 'utf-8') + custom);
    await observabilityLangfuseGenerator(tree, options);
    const construct = tree.read(CONSTRUCT, 'utf-8');
    expect(construct).toContain(
      "export const custom = { environmentVariables: { CUSTOM: 'value' } };",
    );
    expect(
      construct.match(/\.\.\.langfuseObservability\.environmentVariables/g),
    ).toHaveLength(1);
  });

  it('reports removed wiring without claiming the agent is configured', async () => {
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);
    tree.write(
      CONSTRUCT,
      tree
        .read(CONSTRUCT, 'utf-8')
        .replace('configureLangfuseRuntime(this.agentCoreRuntime);', ''),
    );
    const before = files(tree);
    await expect(observabilityLangfuseGenerator(tree, options)).rejects.toThrow(
      'runtime wiring was customized or removed',
    );
    expect(files(tree)).toEqual(before);
  });

  it('retains the previous host and allows an explicit host or secret change', async () => {
    await addAgent();
    await observabilityLangfuseGenerator(tree, {
      ...options,
      host: 'https://example.com/langfuse/',
    });
    await observabilityLangfuseGenerator(tree, { project: options.project });
    expect(tree.read(CONFIG, 'utf-8')).toContain(
      'https://example.com/langfuse',
    );
    const replacement = SECRET.replace('abcdef', 'ghijkl');
    await observabilityLangfuseGenerator(tree, {
      ...options,
      secretArn: replacement,
      host: 'https://us.cloud.langfuse.com',
    });
    expect(tree.read(CONFIG, 'utf-8')).toContain(replacement);
    expect(tree.read(CONFIG, 'utf-8')).not.toContain(SECRET);
  });

  it('refuses changing options over a customized configuration', async () => {
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);
    tree.write(CONFIG, `${tree.read(CONFIG, 'utf-8')}\n// User change\n`);
    const before = files(tree);
    await expect(
      observabilityLangfuseGenerator(tree, { ...options, mode: 'cloudwatch' }),
    ).rejects.toThrow('customized or removed');
    expect(files(tree)).toEqual(before);
  });

  it('requires selection when several agents exist and keeps other agents intact', async () => {
    await addAgent('first');
    await addAgent('second');
    const first = tree.read(`${MODULE}/first/init.py`, 'utf-8');
    await expect(observabilityLangfuseGenerator(tree, options)).rejects.toThrow(
      '--agent',
    );
    await observabilityLangfuseGenerator(tree, { ...options, agent: 'second' });
    expect(tree.read(`${MODULE}/first/init.py`, 'utf-8')).toBe(first);
    const second = tree.read(`${MODULE}/second/init.py`, 'utf-8');
    await observabilityLangfuseGenerator(tree, { ...options, agent: 'first' });
    expect(tree.read(`${MODULE}/second/init.py`, 'utf-8')).toBe(second);
  });

  it.each([
    ['framework', 'langchain'],
    ['protocol', 'a2a'],
    ['protocol', 'ag-ui'],
    ['infra', 'agentcore-ecr'],
    ['infra', 'none'],
    ['iac', 'terraform'],
    ['auth', 'cognito'],
  ])('rejects unsupported %s=%s before editing files', async (field, value) => {
    await addAgent();
    const project = readProjectConfiguration(tree, options.project);
    (project.metadata.components as Record<string, unknown>[])[0][field] =
      value;
    updateProjectConfiguration(tree, project.name, project);
    const before = files(tree);
    await expect(observabilityLangfuseGenerator(tree, options)).rejects.toThrow(
      'Experimental Langfuse support requires',
    );
    expect(files(tree)).toEqual(before);
  });

  it.each([
    'http://example.com',
    'https://user:password@example.com',
    'https://example.com?key=anything',
    'https://example.com#fragment',
  ])('rejects unsafe host %s before editing files', async (host) => {
    await addAgent();
    const before = files(tree);
    await expect(
      observabilityLangfuseGenerator(tree, { ...options, host }),
    ).rejects.toThrow('HTTPS base URL');
    expect(files(tree)).toEqual(before);
  });

  it('requires a complete secret ARN', async () => {
    await addAgent();
    const before = files(tree);
    await expect(
      observabilityLangfuseGenerator(tree, { project: options.project }),
    ).rejects.toThrow('complete ARN');
    expect(files(tree)).toEqual(before);
  });

  it('rejects customized entrypoints and FastAPI telemetry', async () => {
    await addAgent();
    tree.write(
      CONSTRUCT,
      tree
        .read(CONSTRUCT, 'utf-8')
        .replace('agentcore_launcher.py', 'custom.py'),
    );
    await expect(observabilityLangfuseGenerator(tree, options)).rejects.toThrow(
      'customized',
    );
    expect(tree.exists(CONFIG)).toBe(false);
    tree.write(
      CONSTRUCT,
      tree
        .read(CONSTRUCT, 'utf-8')
        .replace('custom.py', 'agentcore_launcher.py'),
    );
    tree.write(
      `${AGENT}/init.py`,
      tree
        .read(`${AGENT}/init.py`, 'utf-8')
        .replace(
          'app = FastAPI(',
          'app = FastAPI(telemetry={"tracing": True},',
        ),
    );
    await expect(observabilityLangfuseGenerator(tree, options)).rejects.toThrow(
      'customized',
    );
    expect(tree.exists(CONFIG)).toBe(false);
  });
});
