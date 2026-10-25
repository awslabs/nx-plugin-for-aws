/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addProjectConfiguration,
  logger,
  readJson,
  readProjectConfiguration,
  type Tree,
  updateJson,
  writeJson,
} from '@nx/devkit';
import { tsInfraGenerator } from '../../../infra/app/generator.js';
import { tsAgentGenerator } from '../../../ts/agent/generator.js';
import { tsAgentGuardrailsGenerator } from '../../../ts/agent/guardrails/generator.js';
import {
  cdkGuardrailWiring,
  PY_AGENT_TERRAFORM_DEPLOY_GUIDE_URL,
  terraformGuardrailWiring,
} from '../../../utils/guardrail-constructs/guardrail-wiring.js';
import { expectHasMetricTags } from '../../../utils/metrics-assertions.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { pyAgentGenerator } from '../generator.js';
import type { AgentProtocol, PyAgentFramework } from '../schema';
import {
  PY_AGENT_GUARDRAILS_GENERATOR_INFO,
  pyAgentGuardrailsGenerator,
} from './generator.js';

const MODULE_DIR = 'apps/test-project/proj_test_project';
const AGENT_DIR = `${MODULE_DIR}/agent`;
const AGENT_FILE = `${AGENT_DIR}/agent.py`;
const CONSTRUCTS_APP = 'packages/common/constructs/src/app';
const TERRAFORM_APP = 'packages/common/terraform/src/app';
const CONSTRUCT_FILE = `${CONSTRUCTS_APP}/guardrails/test-project-agent/test-project-agent-guardrail.ts`;
const MODULE_FILE = `${TERRAFORM_APP}/guardrails/test-project-agent/test-project-agent-guardrail.tf`;
const GUIDE_FILE = join(
  import.meta.dirname,
  '../../../../../../docs/src/content/docs/en/guides/py-agent-guardrails.mdx',
);

const changedFiles = (tree: Tree): Record<string, string> =>
  Object.fromEntries(
    tree
      .listChanges()
      .filter((c) => c.type !== 'DELETE')
      .map((c) => [c.path, c.content?.toString('utf-8') ?? '']),
  );

/** Add a Python project the way py#agent's own specs do. */
const addPythonProject = (
  tree: Tree,
  name = 'test-project',
  root = 'apps/test-project',
  moduleName = 'proj_test_project',
  distributionName = 'proj.test_project',
) => {
  addProjectConfiguration(tree, name, {
    root,
    sourceRoot: `${root}/${moduleName}`,
    targets: {
      build: {
        executor: '@nxlv/python:build',
        options: { outputPath: `dist/${root}` },
      },
    },
  });
  tree.write(
    `${root}/pyproject.toml`,
    `[project]
name = "${distributionName}"
version = "0.1.0"
dependencies = []

[dependency-groups]
dev = []

[tool.uv]
dev-dependencies = []
`,
  );
};

describe('py#agent#guardrails generator', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
    addPythonProject(tree);
    tree.write('aws-nx-plugin.config.mts', 'export default {};\n');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const addAgent = (
    options: {
      name?: string;
      framework?: PyAgentFramework;
      protocol?: AgentProtocol;
      iac?: 'cdk' | 'terraform';
      infra?: 'agentcore' | 'none';
    } = {},
  ) =>
    pyAgentGenerator(tree, {
      project: 'test-project',
      name: options.name,
      framework: options.framework,
      protocol: options.protocol,
      infra: options.infra ?? 'agentcore',
      iac: options.iac ?? 'cdk',
      ...(options.framework === 'langchain' ? { session: 'in-memory' } : {}),
      preferInstallDependencies: false,
    });

  const warnings = (warn: { mock: { calls: unknown[][] } }): string[] =>
    warn.mock.calls.map((c) => String(c[0]));

  describe('agent selection', () => {
    it('should throw when the project has no Python Agent', async () => {
      await expect(
        pyAgentGuardrailsGenerator(tree, { project: 'test-project' }),
      ).rejects.toThrow(
        'Project test-project has no Python Agent. Add one with the py#agent generator first.',
      );
    });

    it('should throw when the project has several agents and none is named', async () => {
      await addAgent({ name: 'a', infra: 'none' });
      await addAgent({ name: 'b', infra: 'none' });

      await expect(
        pyAgentGuardrailsGenerator(tree, { project: 'test-project' }),
      ).rejects.toThrow(
        'Project test-project has more than one Python Agent. Specify which to guard with --agent. Available agents: a, b',
      );
    });

    it('should throw when the named agent does not exist', async () => {
      await addAgent({ infra: 'none' });

      await expect(
        pyAgentGuardrailsGenerator(tree, {
          project: 'test-project',
          agent: 'nope',
        }),
      ).rejects.toThrow(
        'No Python Agent named nope in project test-project. Available agents: agent',
      );
    });

    it('should guard only the named agent', async () => {
      await addAgent({ name: 'a', infra: 'none' });
      await addAgent({ name: 'b', infra: 'none' });

      await pyAgentGuardrailsGenerator(tree, {
        project: 'test-project',
        agent: 'b',
      });

      expect(tree.exists(`${MODULE_DIR}/b/guardrail.py`)).toBeTruthy();
      expect(tree.exists(`${MODULE_DIR}/a/guardrail.py`)).toBeFalsy();
      expect(tree.read(`${MODULE_DIR}/a/agent.py`, 'utf-8')).not.toContain(
        'get_guardrailed_model',
      );
    });
  });

  describe.each(['strands', 'langchain'] as const)(
    'framework %s',
    (framework) => {
      describe.each(['http', 'a2a', 'ag-ui'] as const)(
        'protocol %s',
        (protocol) => {
          it.each(['cdk', 'terraform'] as const)(
            'should generate the guardrail with %s',
            async (iac) => {
              await addAgent({ framework, protocol, iac });

              await pyAgentGuardrailsGenerator(tree, {
                project: 'test-project',
              });

              expect(tree.read(AGENT_FILE, 'utf-8')).toMatchSnapshot(
                'agent.py',
              );
              expect(
                tree.read(`${AGENT_DIR}/guardrail.py`, 'utf-8'),
              ).toMatchSnapshot('guardrail.py');
              expect(
                tree.read(`${AGENT_DIR}/guardrail.json`, 'utf-8'),
              ).toMatchSnapshot('guardrail.json');
              if (iac === 'cdk') {
                expect(tree.read(CONSTRUCT_FILE, 'utf-8')).toMatchSnapshot(
                  'construct',
                );
                expect(
                  tree.read(`${CONSTRUCTS_APP}/guardrails/index.ts`, 'utf-8'),
                ).toMatchSnapshot('guardrails/index.ts');
                expect(
                  tree.read(`${CONSTRUCTS_APP}/index.ts`, 'utf-8'),
                ).toMatchSnapshot('app/index.ts');
              } else {
                expect(tree.read(MODULE_FILE, 'utf-8')).toMatchSnapshot(
                  'module',
                );
              }
            },
          );

          it('should build the agent with the guardrailed model', async () => {
            await addAgent({ framework, protocol });
            const entryPoints = ['main.py', 'init.py'].filter((f) =>
              tree.exists(`${AGENT_DIR}/${f}`),
            );
            const before = entryPoints.map((f) =>
              tree.read(`${AGENT_DIR}/${f}`, 'utf-8'),
            );

            await pyAgentGuardrailsGenerator(tree, { project: 'test-project' });

            const agentPy = tree.read(AGENT_FILE, 'utf-8');
            if (framework === 'strands') {
              expect(agentPy).toMatch(
                /Agent\(\s*model=get_guardrailed_model\(\),/,
              );
              expect(agentPy.match(/model=/g)).toHaveLength(1);
              expect(agentPy).toContain(
                'from .guardrail import get_guardrailed_model',
              );
            } else {
              expect(agentPy).toContain(
                'GuardrailedChatBedrockConverse(model=MODEL_ID, region_name=REGION)',
              );
              expect(agentPy).toContain(
                'from .guardrail import GuardrailedChatBedrockConverse',
              );
              expect(agentPy).not.toMatch(/(^|[^d])ChatBedrockConverse\(/m);
              expect(agentPy).not.toContain(
                'from langchain_aws import ChatBedrockConverse',
              );
            }
            expect(
              entryPoints.map((f) => tree.read(`${AGENT_DIR}/${f}`, 'utf-8')),
            ).toEqual(before);
          });

          it('should leave every file unchanged on a second run', async () => {
            await addAgent({ framework, protocol });
            await pyAgentGuardrailsGenerator(tree, { project: 'test-project' });
            const first = changedFiles(tree);
            const warn = vi.spyOn(logger, 'warn');

            await pyAgentGuardrailsGenerator(tree, { project: 'test-project' });

            expect(changedFiles(tree)).toEqual(first);
            expect(warn).not.toHaveBeenCalled();
            const components = readProjectConfiguration(tree, 'test-project')
              .metadata.components as { generator: string }[];
            expect(
              components.filter(
                (c) => c.generator === PY_AGENT_GUARDRAILS_GENERATOR_INFO.id,
              ),
            ).toHaveLength(1);
          });
        },
      );
    },
  );

  it('should leave a Strands agent.py that already sets a model unchanged and say what to add', async () => {
    await addAgent({ infra: 'none' });
    const custom = `from strands import Agent
from strands.models import BedrockModel


def get_agent():
    return Agent(
        model=BedrockModel(model_id="x"),
        tools=[],
    )
`;
    tree.write(AGENT_FILE, custom);
    const warn = vi.spyOn(logger, 'warn');

    await pyAgentGuardrailsGenerator(tree, { project: 'test-project' });

    expect(tree.read(AGENT_FILE, 'utf-8')).toBe(custom);
    expect(tree.exists(`${AGENT_DIR}/guardrail.py`)).toBeTruthy();
    const modelMessages = warnings(warn).filter((m) => m.includes(AGENT_FILE));
    expect(modelMessages).toHaveLength(1);
    expect(modelMessages[0]).toContain('model=get_guardrailed_model(),');
    expect(modelMessages[0]).toContain(
      'from .guardrail import get_guardrailed_model',
    );
  });

  it('should leave a LangChain agent.py without ChatBedrockConverse unchanged and say what to add', async () => {
    await addAgent({ framework: 'langchain', infra: 'none' });
    const custom = `from langchain.agents import create_agent
from langchain.chat_models import init_chat_model


def get_agent():
    return create_agent(model=init_chat_model("x"), tools=[])
`;
    tree.write(AGENT_FILE, custom);
    const warn = vi.spyOn(logger, 'warn');

    await pyAgentGuardrailsGenerator(tree, { project: 'test-project' });

    expect(tree.read(AGENT_FILE, 'utf-8')).toBe(custom);
    const modelMessages = warnings(warn).filter((m) => m.includes(AGENT_FILE));
    expect(modelMessages).toHaveLength(1);
    expect(modelMessages[0]).toContain(
      'GuardrailedChatBedrockConverse(model=MODEL_ID, region_name=REGION)',
    );
    expect(modelMessages[0]).toContain(
      'from .guardrail import GuardrailedChatBedrockConverse',
    );
  });

  it.each(['strands', 'langchain'] as const)(
    'should say a deleted %s agent.py does not exist and still write guardrail.py',
    async (framework) => {
      await addAgent({ framework, infra: 'none' });
      tree.delete(AGENT_FILE);
      const warn = vi.spyOn(logger, 'warn');

      await pyAgentGuardrailsGenerator(tree, { project: 'test-project' });

      expect(tree.exists(AGENT_FILE)).toBeFalsy();
      expect(tree.exists(`${AGENT_DIR}/guardrail.py`)).toBeTruthy();
      const modelMessages = warnings(warn).filter((m) =>
        m.includes(AGENT_FILE),
      );
      expect(modelMessages).toHaveLength(1);
      expect(modelMessages[0]).toContain('the file does not exist');
    },
  );

  it('should keep a user edit of guardrail.json on a re-run', async () => {
    await addAgent();
    await pyAgentGuardrailsGenerator(tree, { project: 'test-project' });
    const edited = '{ "blockedInputMessaging": "No." }\n';
    tree.write(`${AGENT_DIR}/guardrail.json`, edited);

    await pyAgentGuardrailsGenerator(tree, { project: 'test-project' });

    expect(tree.read(`${AGENT_DIR}/guardrail.json`, 'utf-8')).toBe(edited);
  });

  it('should skip infrastructure and warn when the agent has none', async () => {
    await addAgent({ infra: 'none' });
    const warn = vi.spyOn(logger, 'warn');

    await pyAgentGuardrailsGenerator(tree, { project: 'test-project' });

    expect(tree.exists(`${CONSTRUCTS_APP}/guardrails`)).toBeFalsy();
    expect(tree.exists(`${TERRAFORM_APP}/guardrails`)).toBeFalsy();
    expect(tree.exists(`${AGENT_DIR}/guardrail.json`)).toBeTruthy();
    expect(tree.read(AGENT_FILE, 'utf-8')).toContain(
      'model=get_guardrailed_model()',
    );
    const infraMessages = warnings(warn).filter((m) =>
      m.includes('has no infrastructure'),
    );
    expect(infraMessages).toHaveLength(1);
    expect(infraMessages[0]).toContain(
      'write its ID and version to runtime config at agentcore.guardrails.TestProjectAgent as { guardrailId, guardrailVersion }.',
    );
    expect(infraMessages[0]).not.toContain('GUARDRAIL_ID');
  });

  it.each(['cdk', 'terraform'] as const)(
    "should write each agent's guardrail to its own runtime-config key with %s",
    async (iac) => {
      await addAgent({ name: 'my-agent', iac });
      await addAgent({ name: 'other-agent', iac });

      for (const agent of ['my-agent', 'other-agent']) {
        await pyAgentGuardrailsGenerator(tree, {
          project: 'test-project',
          agent,
        });
      }

      const file = (name: string) =>
        tree.read(
          iac === 'cdk'
            ? `${CONSTRUCTS_APP}/guardrails/${name}/${name}-guardrail.ts`
            : `${TERRAFORM_APP}/guardrails/${name}/${name}-guardrail.tf`,
          'utf-8',
        );
      const mine = file('my-agent');
      const other = file('other-agent');
      if (iac === 'cdk') {
        expect(mine).toContain('MyAgent: {');
        expect(other).toContain('OtherAgent: {');
      } else {
        expect(mine).toContain('"MyAgent" =');
        expect(other).toContain('"OtherAgent" =');
      }
      expect(mine).not.toContain('OtherAgent');
      expect(other).not.toContain('MyAgent');
      expect(
        tree.read(`${MODULE_DIR}/my_agent/guardrail.py`, 'utf-8'),
      ).toContain('RUNTIME_CONFIG_KEY = "agentcore.guardrails.MyAgent"');
      expect(
        tree.read(`${MODULE_DIR}/other_agent/guardrail.py`, 'utf-8'),
      ).toContain('RUNTIME_CONFIG_KEY = "agentcore.guardrails.OtherAgent"');
    },
  );

  it('should add the CDK construct, reading the agent policy', async () => {
    await addAgent({ iac: 'cdk' });

    await pyAgentGuardrailsGenerator(tree, { project: 'test-project' });

    const construct = tree.read(CONSTRUCT_FILE, 'utf-8');
    expect(construct).toContain('export class TestProjectAgentGuardrail');
    expect(construct).toContain(
      "'apps/test-project/proj_test_project/agent/guardrail.json'",
    );
    expect(tree.exists(`${TERRAFORM_APP}/guardrails`)).toBeFalsy();
  });

  it('should add the Terraform module, reading the agent policy', async () => {
    await addAgent({ iac: 'terraform' });

    await pyAgentGuardrailsGenerator(tree, { project: 'test-project' });

    const module = tree.read(MODULE_FILE, 'utf-8');
    expect(module).toContain(
      '../../../../../../../apps/test-project/proj_test_project/agent/guardrail.json',
    );
    expect(module).toContain('filesha256(');
    expect(tree.exists(`${CONSTRUCTS_APP}/guardrails`)).toBeFalsy();
  });

  it('should vend the same guardrail.json as ts#agent#guardrails', async () => {
    await addAgent({ infra: 'none' });
    await pyAgentGuardrailsGenerator(tree, { project: 'test-project' });

    const tsTree = createTreeUsingTsSolutionSetup();
    addProjectConfiguration(tsTree, 'ts-project', {
      root: 'apps/ts-project',
      sourceRoot: 'apps/ts-project/src',
      targets: {},
    });
    writeJson(tsTree, 'apps/ts-project/tsconfig.json', {});
    writeJson(tsTree, 'apps/ts-project/package.json', {
      name: 'ts-project',
      version: '1.0.0',
    });
    await tsAgentGenerator(tsTree, {
      project: 'ts-project',
      infra: 'none',
      iac: 'cdk',
      preferInstallDependencies: false,
    });
    await tsAgentGuardrailsGenerator(tsTree, { project: 'ts-project' });

    expect(tree.read(`${AGENT_DIR}/guardrail.json`, 'utf-8')).toBe(
      tsTree.read('apps/ts-project/src/agent/guardrail.json', 'utf-8'),
    );
  });

  it('should refuse to guard an agent whose class name a TypeScript agent already guards', async () => {
    addProjectConfiguration(tree, 'agents', {
      root: 'apps/agents',
      sourceRoot: 'apps/agents/src',
      targets: {},
    });
    writeJson(tree, 'apps/agents/tsconfig.json', {});
    writeJson(tree, 'apps/agents/package.json', {
      name: 'agents',
      version: '1.0.0',
    });
    await tsAgentGenerator(tree, {
      project: 'agents',
      infra: 'agentcore',
      iac: 'cdk',
      preferInstallDependencies: false,
    });
    await tsAgentGuardrailsGenerator(tree, { project: 'agents' });
    addPythonProject(
      tree,
      'proj.agents',
      'apps/py-agents',
      'proj_agents',
      'proj.agents',
    );
    await pyAgentGenerator(tree, {
      project: 'proj.agents',
      infra: 'agentcore',
      iac: 'cdk',
      preferInstallDependencies: false,
    });
    const constructBefore = tree.read(
      `${CONSTRUCTS_APP}/guardrails/agents-agent/agents-agent-guardrail.ts`,
      'utf-8',
    );

    await expect(
      pyAgentGuardrailsGenerator(tree, { project: 'proj.agents' }),
    ).rejects.toThrow(
      `Guardrail infrastructure for AgentsAgent already exists at ${CONSTRUCTS_APP}/guardrails/agents-agent/agents-agent-guardrail.ts for another agent's guardrail.json. Agents in different projects that share the class name AgentsAgent share one runtime construct; give one of them a different name.`,
    );
    expect(tree.exists('apps/py-agents/proj_agents/agent/guardrail.py')).toBe(
      false,
    );
    expect(tree.exists('apps/py-agents/proj_agents/agent/guardrail.json')).toBe(
      false,
    );
    expect(
      tree.read(
        `${CONSTRUCTS_APP}/guardrails/agents-agent/agents-agent-guardrail.ts`,
        'utf-8',
      ),
    ).toBe(constructBefore);
  });

  describe('wiring message', () => {
    beforeEach(() => {
      updateJson(tree, 'package.json', (json) => ({
        ...json,
        name: '@gr-sandbox/source',
      }));
    });

    /** Run the generator and its callback, returning what the callback logged. */
    const runAndCaptureInfo = async (agent?: string): Promise<string[]> => {
      const callback = await pyAgentGuardrailsGenerator(tree, {
        project: 'test-project',
        agent,
      });
      const info = vi.spyOn(logger, 'info').mockImplementation(() => {});
      callback();
      const messages = info.mock.calls.map((c) => String(c[0]));
      info.mockRestore();
      return messages;
    };

    it('should print the CDK stack code with the agent names filled in', async () => {
      await addAgent({ name: 'my-agent', iac: 'cdk' });

      expect(await runAndCaptureInfo()).toEqual([
        `Add the guardrail to your agent in your stack, for example packages/infra/src/stacks/application-stack.ts. Until you add it, the deployed agent fails on its first request, because runtime config has no guardrail at agentcore.guardrails.MyAgent.

import { MyAgent, MyAgentGuardrail } from '@gr-sandbox/common-constructs';

const agent = new MyAgent(this, 'MyAgent');
new MyAgentGuardrail(this, 'MyAgentGuardrail', { agent });`,
      ]);
    });

    it('should print the Terraform module code with the agent names filled in', async () => {
      await addAgent({ name: 'my-agent', iac: 'terraform' });

      expect(await runAndCaptureInfo()).toEqual([
        `Add the guardrail to your agent in the root Terraform module where you deploy the agent, for example packages/infra/src/main.tf. Until you add it, the deployed agent fails on its first request, because runtime config has no guardrail at agentcore.guardrails.MyAgent. Add the module "my_agent_guardrail" block as printed below. Add its additional_iam_policy_statements line to your existing module "my_agent" block, and add module.my_agent_guardrail to the depends_on list of your runtime_config_appconfig_deployment module. If your root module does not deploy the agent yet, add the agent's module first, as described in https://awslabs.github.io/nx-plugin-for-aws/en/guides/py-agent/#infrastructure-as-code.

module "my_agent_guardrail" {
  source = "../../common/terraform/src/app/guardrails/my-agent"
}

module "my_agent" {
  source = "../../common/terraform/src/app/agents/my-agent"
  # ...existing arguments...
  additional_iam_policy_statements = module.my_agent_guardrail.iam_policy_statements
}

module "runtime_config_appconfig_deployment" {
  # ...existing arguments...
  depends_on = [
    # ...existing modules...
    module.my_agent_guardrail,
  ]
}`,
      ]);
    });

    it.each([
      ['cdk', ['OtherAgentGuardrail', "new OtherAgent(this, 'OtherAgent'"]],
      [
        'terraform',
        [
          'module "other_agent_guardrail"',
          'app/guardrails/other-agent"',
          'module "other_agent"',
          'module.other_agent_guardrail.iam_policy_statements',
          'module.other_agent_guardrail,',
        ],
      ],
    ] as const)(
      'should name the selected agent in the %s code',
      async (iac, expected) => {
        await addAgent({ name: 'my-agent', iac, infra: 'none' });
        await addAgent({ name: 'other-agent', iac });

        const [message, ...rest] = await runAndCaptureInfo('other-agent');

        expect(rest).toEqual([]);
        for (const text of expected) {
          expect(message).toContain(text);
        }
        expect(message).not.toMatch(/MyAgent|my_agent|my-agent/);
      },
    );

    it('should print the code again on a second run', async () => {
      await addAgent({ iac: 'cdk' });
      const first = await runAndCaptureInfo();

      expect(await runAndCaptureInfo()).toEqual(first);
      expect(first[0]).toContain('TestProjectAgentGuardrail');
    });

    it('should print nothing when the agent has no infrastructure', async () => {
      await addAgent({ infra: 'none' });

      expect(await runAndCaptureInfo()).toEqual([]);
    });

    it.each(['cdk', 'terraform'] as const)(
      'should show the %s code in the guide',
      (iac) => {
        const guide = readFileSync(GUIDE_FILE, 'utf-8');
        const code =
          iac === 'cdk'
            ? cdkGuardrailWiring({
                nameClassName: 'MyAgent',
                npmScope: 'my-scope',
              })
            : terraformGuardrailWiring({ nameKebabCase: 'my-agent' });

        expect(guide).toContain(code);
      },
    );

    it('should link to a py#agent guide heading that exists', () => {
      const [, page, anchor] =
        PY_AGENT_TERRAFORM_DEPLOY_GUIDE_URL.match(
          /\/en\/(guides\/[a-z-]+)\/#([a-z-]+)$/,
        ) ?? [];
      const docs = join(GUIDE_FILE, '../../');
      const guide = readFileSync(join(docs, `${page}.mdx`), 'utf-8');
      const snippet = readFileSync(
        join(docs, 'snippets/agent/bedrock-deployment.mdx'),
        'utf-8',
      );

      // The py#agent guide renders its deployment headings from this snippet.
      const headingSlugs = [...snippet.matchAll(/^#+ (.+)$/gm)].map(([, h]) =>
        h.toLowerCase().replace(/\s+/g, '-'),
      );

      expect(page).toBe('guides/py-agent');
      expect(guide).toContain('<Snippet name="agent/bedrock-deployment"');
      expect(headingSlugs).toContain(anchor);
    });
  });

  it('should record the component and the metric', async () => {
    await addAgent({ iac: 'cdk' });

    await pyAgentGuardrailsGenerator(tree, { project: 'test-project' });

    expect(
      readProjectConfiguration(tree, 'test-project').metadata.components,
    ).toContainEqual({
      generator: PY_AGENT_GUARDRAILS_GENERATOR_INFO.id,
      name: 'agent',
      path: 'proj_test_project/agent',
    });
    expect(PY_AGENT_GUARDRAILS_GENERATOR_INFO.id).toBe('py#agent#guardrails');
    expectHasMetricTags(tree, PY_AGENT_GUARDRAILS_GENERATOR_INFO.metric);
  });

  describe('synth inputs', () => {
    const policyInput = (agentDir: string) =>
      `{workspaceRoot}/${agentDir}/guardrail.json`;

    const addInfra = () =>
      tsInfraGenerator(tree, {
        name: 'infra',
        directory: 'packages',
        preferInstallDependencies: false,
      });

    const synthInputs = () =>
      readJson(tree, 'packages/infra/project.json').targets.synth.inputs;

    it('should add guardrail.json to the synth inputs of the CDK infrastructure once', async () => {
      await addInfra();
      await addAgent({ iac: 'cdk' });

      await pyAgentGuardrailsGenerator(tree, { project: 'test-project' });
      await pyAgentGuardrailsGenerator(tree, { project: 'test-project' });

      expect(synthInputs()).toEqual(['default', policyInput(AGENT_DIR)]);
    });

    it('should add one entry per guarded agent', async () => {
      await addInfra();
      await addAgent({ name: 'my-agent', iac: 'cdk' });
      await addAgent({ name: 'other-agent', iac: 'cdk' });

      for (const agent of ['my-agent', 'other-agent']) {
        await pyAgentGuardrailsGenerator(tree, {
          project: 'test-project',
          agent,
        });
      }

      expect(synthInputs()).toEqual([
        'default',
        policyInput(`${MODULE_DIR}/my_agent`),
        policyInput(`${MODULE_DIR}/other_agent`),
      ]);
    });

    it('should not add synth inputs for a Terraform guardrail', async () => {
      await addInfra();
      await addAgent({ iac: 'terraform' });

      await pyAgentGuardrailsGenerator(tree, { project: 'test-project' });

      expect(synthInputs()).toEqual(['default']);
    });
  });
});
