/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  readProjectConfiguration,
  type Tree,
  updateJson,
  updateProjectConfiguration,
} from '@nx/devkit';
import ts from 'typescript';
import { pyAgentGenerator } from '../../py/agent/generator.js';
import { installDependencies } from '../../utils/install.js';
import { expectHasMetricTags } from '../../utils/metrics-assertions.js';
import { createTreeUsingTsSolutionSetup } from '../../utils/test.js';
import {
  OBSERVABILITY_LANGFUSE_GENERATOR_INFO,
  observabilityLangfuseGenerator,
} from './generator.js';

vi.mock('../../utils/install.js', () => ({
  installDependencies: vi.fn(),
}));

const ROOT = 'apps/test-project';
const MODULE = `${ROOT}/test_project`;
const AGENT = `${MODULE}/agent`;
const CONSTRUCT =
  'packages/common/constructs/src/app/agents/test-project-agent/test-project-agent.ts';
const CONFIG =
  'packages/common/constructs/src/app/agents/test-project-agent/langfuse-observability.ts';
const LOCAL_CONFIG = `${AGENT}/langfuse_dev.py`;
const SECRET =
  'arn:aws:secretsmanager:us-east-1:123456789012:secret:langfuse-abcdef';
const options = {
  project: 'test-project',
  host: 'https://cloud.langfuse.com',
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
    vi.mocked(installDependencies).mockReset();
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
      const main = tree.read(`${AGENT}/main.py`, 'utf-8');
      await observabilityLangfuseGenerator(tree, options);
      expect(tree.read(`${AGENT}/agent.py`, 'utf-8')).toBe(model);
      expect(tree.read(`${ROOT}/package/agent/main.py`, 'utf-8')).toBe(stock);
      expect(tree.read(`${AGENT}/main.py`, 'utf-8')).toBe(main);
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
      expect(config).toContain("rc.set('agentcore', 'langfuse', {");
      expect(config).toContain("...rc.get('agentcore').langfuse");
      expect(config).toContain('TestProjectAgent: {');
      expect(config).not.toContain('LANGFUSE_HOST');
      expect(config).not.toContain('LANGFUSE_SECRET_ARN');
      expect(config).toContain("actions: ['secretsmanager:GetSecretValue']");
      expect(config).not.toContain('LANGFUSE_PUBLIC_KEY');
      expect(config).not.toContain('LANGFUSE_SECRET_KEY');
      expect(config).not.toContain("resources: ['*']");
      expect.soft(config).toMatchSnapshot('Langfuse config');
      const construct = tree.read(CONSTRUCT, 'utf-8');
      expect(construct).not.toContain('opentelemetry-instrument');
      expect(construct).not.toContain('for OpenTelemetry packaged');
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
      const localConfig = tree.read(LOCAL_CONFIG, 'utf-8');
      expect(localConfig).toContain(SECRET);
      expect(localConfig).toContain(options.host);
      expect(localConfig).not.toContain('LANGFUSE_PUBLIC_KEY');
      expect(localConfig).not.toContain('LANGFUSE_SECRET_KEY');
      expect.soft(localConfig).toMatchSnapshot('local entrypoint');
      expectHasMetricTags(tree, OBSERVABILITY_LANGFUSE_GENERATOR_INFO.metric);
    },
  );

  it.each([undefined, '', ' \t\n'])(
    'requires a nonblank endpoint on first use (%j)',
    async (host) => {
      await addAgent();
      const before = files(tree);
      await expect(
        observabilityLangfuseGenerator(tree, { ...options, host }),
      ).rejects.toThrow('Provide --host');
      expect(files(tree)).toEqual(before);
      expect(tree.read(`${AGENT}/init.py`, 'utf-8')).not.toContain('langfuse');
    },
  );

  it('generates Python imports and filenames from Windows agent paths', async () => {
    await addAgent();
    const project = readProjectConfiguration(tree, options.project);
    const agent = (
      project.metadata.components as { generator: string; path: string }[]
    ).find((component) => component.generator === 'py#agent');
    if (!agent) {
      throw new Error('Expected generated Python agent metadata');
    }
    agent.path = agent.path.replaceAll('/', '\\');
    updateProjectConfiguration(tree, project.name, project);

    await observabilityLangfuseGenerator(tree, options);

    expect(
      tree.read(`${ROOT}/package/agent/langfuse_main.py`, 'utf-8'),
    ).toContain('from test_project.agent.langfuse_telemetry import ');
    expect(
      tree.read(`${ROOT}/tests/test_agent_langfuse.py`, 'utf-8'),
    ).toContain('from test_project.agent import langfuse_telemetry');
    expect(tree.exists(`${AGENT}/langfuse_telemetry.py`)).toBe(true);
    expect(tree.read(LOCAL_CONFIG, 'utf-8')).toContain('"test_project.agent"');
    expect(
      readProjectConfiguration(tree, options.project).targets['agent-dev']
        .options.commands,
    ).toEqual([
      'uv run uvicorn test_project.agent.langfuse_dev:app --reload --port 8081',
    ]);
    const generated = files(tree);
    await observabilityLangfuseGenerator(tree, options);
    expect(files(tree)).toEqual(generated);
  });

  it.each([
    ['module', '.js'],
    ['commonjs', ''],
  ])('uses %s imports for CDK wiring', async (type, suffix) => {
    updateJson(tree, 'package.json', (json) => ({ ...json, type }));
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);

    expect(tree.read(CONSTRUCT, 'utf-8')).toContain(
      `from './langfuse-observability${suffix}'`,
    );
    expect(tree.read(CONFIG, 'utf-8')).toContain(
      `from '../../../core/runtime-config${suffix}'`,
    );
    const generated = files(tree);
    await observabilityLangfuseGenerator(tree, options);
    expect(files(tree)).toEqual(generated);
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

  it.each([undefined, true, false])(
    'honors the installation preference on an unchanged run (%s)',
    async (preferInstallDependencies) => {
      await addAgent();
      const first = await observabilityLangfuseGenerator(tree, options);
      await first();
      expect(installDependencies).toHaveBeenCalledWith(tree, false, {
        languages: ['python'],
      });
      vi.mocked(installDependencies).mockClear();
      const before = files(tree);

      const again = await observabilityLangfuseGenerator(tree, {
        ...options,
        preferInstallDependencies,
      });
      expect(installDependencies).not.toHaveBeenCalled();
      await again();

      expect(installDependencies).toHaveBeenCalledExactlyOnceWith(
        tree,
        preferInstallDependencies,
        { languages: ['python'] },
      );
      expect(files(tree)).toEqual(before);
    },
  );

  it('retries a failed installation without changing generated files', async () => {
    await addAgent();
    const installOptions = { ...options, preferInstallDependencies: true };
    const first = await observabilityLangfuseGenerator(tree, installOptions);
    vi.mocked(installDependencies).mockRejectedValueOnce(
      new Error('Dependency installation failed'),
    );
    await expect(first()).rejects.toThrow('Dependency installation failed');
    const before = files(tree);

    const again = await observabilityLangfuseGenerator(tree, installOptions);
    await again();

    expect(installDependencies).toHaveBeenCalledTimes(2);
    expect(installDependencies).toHaveBeenLastCalledWith(tree, true, {
      languages: ['python'],
    });
    expect(files(tree)).toEqual(before);
  });

  it('does not record a mode and preserves earlier experimental metadata on repeat runs', async () => {
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);
    const project = readProjectConfiguration(tree, options.project);
    const component = (
      project.metadata.components as Record<string, unknown>[]
    ).find(
      (entry) => entry.generator === OBSERVABILITY_LANGFUSE_GENERATOR_INFO.id,
    );
    expect(component).not.toHaveProperty('mode');
    if (!component) {
      throw new Error('Expected Langfuse metadata');
    }
    component.mode = 'langfuse';
    updateProjectConfiguration(tree, project.name, project);
    const before = files(tree);
    await observabilityLangfuseGenerator(tree, options);
    expect(files(tree)).toEqual(before);
  });

  it.each(['outputs', 'commands'])(
    'rejects an unrecognized package target %s before editing files',
    async (field) => {
      await addAgent();
      const project = readProjectConfiguration(tree, options.project);
      if (field === 'outputs') {
        delete project.targets['agent-package'].outputs;
      } else {
        project.targets['agent-package'].options.commands = 'custom-package';
      }
      updateProjectConfiguration(tree, project.name, project);
      const before = files(tree);
      await expect(
        observabilityLangfuseGenerator(tree, options),
      ).rejects.toThrow('package target was not recognized');
      expect(files(tree)).toEqual(before);
    },
  );

  it('restores packaging after re-running the agent generator', async () => {
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);
    const before = files(tree);
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);
    expect(files(tree)).toEqual(before);
  });

  it('uses the local entrypoint for dev and serve while preserving target settings', async () => {
    await addAgent();
    const project = readProjectConfiguration(tree, options.project);
    const dev = project.targets['agent-dev'];
    dev.options.env.CUSTOM = 'retained';
    dev.options.commands.push('echo custom-preparation');
    dev.parallelism = false;
    updateProjectConfiguration(tree, project.name, project);

    await observabilityLangfuseGenerator(tree, options);

    const configured = readProjectConfiguration(tree, options.project);
    expect(configured.targets['agent-dev']).toEqual({
      ...dev,
      options: {
        ...dev.options,
        commands: [
          'uv run uvicorn test_project.agent.langfuse_dev:app --reload --port 8081',
          'echo custom-preparation',
        ],
      },
    });
    expect(configured.targets['agent-dev'].options.env).toMatchObject({
      LOCAL_DEV: 'true',
      PORT: '8081',
      CUSTOM: 'retained',
    });
    expect(configured.targets['agent-serve'].options.commands).toEqual([
      'uv run uvicorn test_project.agent.langfuse_dev:app --reload --port 8081',
    ]);
    expect(configured.targets['agent-serve'].options.env).toEqual({
      PORT: '8081',
    });
  });

  it.each(['dev', 'serve'])(
    'rejects a customized %s command before editing files',
    async (suffix) => {
      await addAgent();
      const project = readProjectConfiguration(tree, options.project);
      project.targets[`agent-${suffix}`].options.commands = [
        'python custom.py',
      ];
      updateProjectConfiguration(tree, project.name, project);
      const before = files(tree);

      await expect(
        observabilityLangfuseGenerator(tree, options),
      ).rejects.toThrow(`agent-${suffix} target was customized or removed`);
      expect(files(tree)).toEqual(before);
    },
  );

  it.each(['removed', 'duplicate', 'cwd', 'executor'])(
    'rejects ambiguous local target wiring (%s) before editing files',
    async (customization) => {
      await addAgent();
      const project = readProjectConfiguration(tree, options.project);
      const dev = project.targets['agent-dev'];
      if (customization === 'removed') {
        delete project.targets['agent-dev'];
      } else if (customization === 'duplicate') {
        dev.options.commands.push(dev.options.commands[0]);
      } else if (customization === 'cwd') {
        dev.options.cwd = 'another-directory';
      } else {
        dev.executor = 'custom:dev';
      }
      updateProjectConfiguration(tree, project.name, project);
      const before = files(tree);
      await expect(
        observabilityLangfuseGenerator(tree, options),
      ).rejects.toThrow('agent-dev target was customized or removed');
      expect(files(tree)).toEqual(before);
    },
  );

  it('refuses to overwrite an existing local entrypoint', async () => {
    await addAgent();
    tree.write(LOCAL_CONFIG, '# User-owned entrypoint\n');
    const before = files(tree);
    await expect(observabilityLangfuseGenerator(tree, options)).rejects.toThrow(
      'Refusing to overwrite existing file',
    );
    expect(files(tree)).toEqual(before);
  });

  it('reports an older experimental setup before adding incompatible local wiring', async () => {
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);
    const project = readProjectConfiguration(tree, options.project);
    const component = (
      project.metadata.components as Record<string, unknown>[]
    ).find(
      (entry) => entry.generator === OBSERVABILITY_LANGFUSE_GENERATOR_INFO.id,
    );
    if (!component) {
      throw new Error('Expected Langfuse metadata');
    }
    delete component.localConfigHash;
    updateProjectConfiguration(tree, project.name, project);
    const before = files(tree);

    await expect(observabilityLangfuseGenerator(tree, options)).rejects.toThrow(
      'predates local trace export',
    );
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

  it.each([
    [CONSTRUCT, 'langfuseObservability.entrypoint', "['custom.py']"],
    [CONSTRUCT, 'configureLangfuseRuntime(this.agentCoreRuntime);', ''],
    [CONSTRUCT, '...langfuseObservability.environmentVariables', '...{}'],
    [`${AGENT}/init.py`, '**langfuse_fastapi_options()', '**{}'],
    [LOCAL_CONFIG, 'initialize(', 'custom_initialize('],
  ])(
    'reports removed wiring in %s (%s) before editing files',
    async (path, original, replacement) => {
      await addAgent();
      await observabilityLangfuseGenerator(tree, options);
      const source = tree.read(path, 'utf-8');
      expect(source).toContain(original);
      tree.write(path, source.replace(original, replacement));
      const before = files(tree);
      await expect(
        observabilityLangfuseGenerator(tree, options),
      ).rejects.toThrow('runtime wiring was customized or removed');
      expect(files(tree)).toEqual(before);
    },
  );

  it.each([
    { host: '' },
    { secretArn: '' },
    { host: '', secretArn: '' },
    { host: ' \t\n', secretArn: ' \t\n' },
  ])('retains saved options for blank prompt answers (%j)', async (blank) => {
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);
    const before = files(tree);
    await observabilityLangfuseGenerator(tree, {
      project: options.project,
      ...blank,
    });
    expect(files(tree)).toEqual(before);
  });

  it('trims pasted values and allows replacing one option while leaving the other blank', async () => {
    await addAgent();
    await observabilityLangfuseGenerator(tree, {
      ...options,
      host: `  ${options.host}/ \n`,
      secretArn: ` \t${SECRET}\n`,
    });
    const before = files(tree);
    await observabilityLangfuseGenerator(tree, options);
    expect(files(tree)).toEqual(before);
    await observabilityLangfuseGenerator(tree, {
      project: options.project,
      host: ' https://example.com/langfuse/ ',
      secretArn: '',
    });
    expect(tree.read(CONFIG, 'utf-8')).toContain(SECRET);
    expect(tree.read(CONFIG, 'utf-8')).toContain(
      'https://example.com/langfuse',
    );
    const replacement = SECRET.replace('abcdef', 'ghijkl');
    await observabilityLangfuseGenerator(tree, {
      project: options.project,
      host: '',
      secretArn: ` ${replacement} `,
    });
    expect(tree.read(CONFIG, 'utf-8')).toContain(replacement);
    expect(tree.read(LOCAL_CONFIG, 'utf-8')).toContain(
      'https://example.com/langfuse',
    );
    expect(tree.read(LOCAL_CONFIG, 'utf-8')).toContain(replacement);
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
    expect(tree.read(LOCAL_CONFIG, 'utf-8')).toContain(
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
    expect(tree.read(LOCAL_CONFIG, 'utf-8')).toContain(replacement);
    expect(tree.read(LOCAL_CONFIG, 'utf-8')).toContain(
      'https://us.cloud.langfuse.com',
    );
    expect(tree.read(LOCAL_CONFIG, 'utf-8')).not.toContain(SECRET);
    const updated = files(tree);
    await observabilityLangfuseGenerator(tree, { project: options.project });
    expect(files(tree)).toEqual(updated);
  });

  it('refuses changing options over a customized configuration', async () => {
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);
    tree.write(CONFIG, `${tree.read(CONFIG, 'utf-8')}\n// User change\n`);
    const before = files(tree);
    await expect(
      observabilityLangfuseGenerator(tree, {
        ...options,
        host: 'https://other.example.com',
      }),
    ).rejects.toThrow('customized or removed');
    expect(files(tree)).toEqual(before);
  });

  it('preserves local entrypoint edits and refuses an option change over them', async () => {
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);
    tree.write(
      LOCAL_CONFIG,
      `${tree.read(LOCAL_CONFIG, 'utf-8')}\n# Custom local setup\n`,
    );
    const before = files(tree);
    await observabilityLangfuseGenerator(tree, options);
    expect(files(tree)).toEqual(before);
    await expect(
      observabilityLangfuseGenerator(tree, {
        ...options,
        host: 'https://other.example.com',
      }),
    ).rejects.toThrow('customized or removed');
    expect(files(tree)).toEqual(before);
  });

  it('reports removed local configuration instead of claiming local export is configured', async () => {
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);
    tree.delete(LOCAL_CONFIG);
    const before = files(tree);
    await expect(observabilityLangfuseGenerator(tree, options)).rejects.toThrow(
      'customized or removed',
    );
    expect(files(tree)).toEqual(before);
  });

  it('reports removed local middleware without changing files', async () => {
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);
    tree.write(
      LOCAL_CONFIG,
      tree
        .read(LOCAL_CONFIG, 'utf-8')
        .replace('app.add_middleware(LangfuseMiddleware)', ''),
    );
    const before = files(tree);
    await expect(observabilityLangfuseGenerator(tree, options)).rejects.toThrow(
      'runtime wiring was customized or removed',
    );
    expect(files(tree)).toEqual(before);
  });

  it('preserves customized local configuration when restoring generated targets', async () => {
    await addAgent();
    await observabilityLangfuseGenerator(tree, options);
    tree.write(
      LOCAL_CONFIG,
      `${tree.read(LOCAL_CONFIG, 'utf-8')}\ncustom_setting=1\n`,
    );
    const before = files(tree);
    const project = readProjectConfiguration(tree, options.project);
    project.targets['agent-dev'].options.commands = [
      'uv run fastapi dev test_project/agent/main.py --port 8081',
    ];
    updateProjectConfiguration(tree, project.name, project);
    await observabilityLangfuseGenerator(tree, options);
    expect(files(tree)).toEqual(before);
  });

  it('requires selection when several agents exist and keeps other agents intact', async () => {
    await addAgent('first');
    await addAgent('second');
    const first = tree.read(`${MODULE}/first/init.py`, 'utf-8');
    const firstDev = readProjectConfiguration(tree, options.project).targets[
      'first-dev'
    ];
    await expect(observabilityLangfuseGenerator(tree, options)).rejects.toThrow(
      '--agent',
    );
    await observabilityLangfuseGenerator(tree, { ...options, agent: 'second' });
    expect(tree.read(`${MODULE}/first/init.py`, 'utf-8')).toBe(first);
    expect(
      readProjectConfiguration(tree, options.project).targets['first-dev'],
    ).toEqual(firstDev);
    expect(tree.exists(`${MODULE}/first/langfuse_dev.py`)).toBe(false);
    const second = tree.read(`${MODULE}/second/init.py`, 'utf-8');
    await observabilityLangfuseGenerator(tree, { ...options, agent: 'first' });
    expect(tree.read(`${MODULE}/second/init.py`, 'utf-8')).toBe(second);
    const firstConfig = tree.read(
      'packages/common/constructs/src/app/agents/first/langfuse-observability.ts',
      'utf-8',
    );
    const secondConfig = tree.read(
      'packages/common/constructs/src/app/agents/second/langfuse-observability.ts',
      'utf-8',
    );
    expect(firstConfig).toContain('First: {');
    expect(firstConfig).not.toContain('Second: {');
    expect(secondConfig).toContain('Second: {');
    expect(secondConfig).not.toContain('First: {');
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

  it.each([undefined, '', ' \t\n', SECRET.replace('-abcdef', '')])(
    'requires a complete nonblank secret ARN on first use (%j)',
    async (secretArn) => {
      await addAgent();
      const before = files(tree);
      await expect(
        observabilityLangfuseGenerator(tree, { ...options, secretArn }),
      ).rejects.toThrow('complete ARN');
      expect(files(tree)).toEqual(before);
    },
  );

  it('wires an empty FastAPI constructor while preserving user comments', async () => {
    await addAgent();
    tree.write(
      `${AGENT}/init.py`,
      'from fastapi import FastAPI\n\n# Custom application setup\napp = FastAPI()\n',
    );
    tree.write(
      CONSTRUCT,
      `${tree.read(CONSTRUCT, 'utf-8')}\n// Custom deployment note\n`,
    );
    await observabilityLangfuseGenerator(tree, options);
    expect(tree.read(`${AGENT}/init.py`, 'utf-8')).toContain(
      'app = FastAPI(**langfuse_fastapi_options())',
    );
    expect(tree.read(`${AGENT}/init.py`, 'utf-8')).toContain(
      '# Custom application setup',
    );
    expect(tree.read(CONSTRUCT, 'utf-8')).toContain(
      '// Custom deployment note',
    );
    const before = files(tree);
    await observabilityLangfuseGenerator(tree, options);
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
