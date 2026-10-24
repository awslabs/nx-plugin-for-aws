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
import {
  cdkGuardrailWiring,
  TS_AGENT_TERRAFORM_DEPLOY_GUIDE_URL,
  terraformGuardrailWiring,
} from '../../../utils/guardrail-constructs/guardrail-wiring.js';
import { expectHasMetricTags } from '../../../utils/metrics-assertions.js';
import { getNpmScope } from '../../../utils/npm-scope.js';
import { TypeScriptVerifier } from '../../../utils/test/ts.spec.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { TERRAFORM_VERSIONS } from '../../../utils/versions.js';
import { tsAgentGenerator } from '../generator.js';
import type { AgentProtocol } from '../schema';
import {
  TS_AGENT_GUARDRAILS_GENERATOR_INFO,
  tsAgentGuardrailsGenerator,
} from './generator.js';

const AGENT_DIR = 'apps/test-project/src/agent';
const AGENT_FILE = `${AGENT_DIR}/agent.ts`;
const CONSTRUCTS_APP = 'packages/common/constructs/src/app';
const TERRAFORM_APP = 'packages/common/terraform/src/app';
const CONSTRUCT_FILE = `${CONSTRUCTS_APP}/guardrails/test-project-agent/test-project-agent-guardrail.ts`;
const MODULE_FILE = `${TERRAFORM_APP}/guardrails/test-project-agent/test-project-agent-guardrail.tf`;
const GUIDE_FILE = join(
  import.meta.dirname,
  '../../../../../../docs/src/content/docs/en/guides/ts-agent-guardrails.mdx',
);

const changedFiles = (tree: Tree): Record<string, string> =>
  Object.fromEntries(
    tree
      .listChanges()
      .filter((c) => c.type !== 'DELETE')
      .map((c) => [c.path, c.content?.toString('utf-8') ?? '']),
  );

describe('ts#agent#guardrails generator', () => {
  let tree: Tree;
  const verifier = new TypeScriptVerifier([
    '@strands-agents/sdk',
    'zod',
    'express',
    // The agent project declares @types/node, which guardrail.ts needs for process.env.
    '@types/node',
  ]);

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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const addAgent = (
    options: {
      name?: string;
      protocol?: AgentProtocol;
      iac?: 'cdk' | 'terraform';
      infra?: 'agentcore' | 'none';
    } = {},
  ) =>
    tsAgentGenerator(tree, {
      project: 'test-project',
      name: options.name,
      protocol: options.protocol,
      infra: options.infra ?? 'agentcore',
      iac: options.iac ?? 'cdk',
      preferInstallDependencies: false,
    });

  describe('agent selection', () => {
    it('should throw when the project has no TypeScript Agent', async () => {
      await expect(
        tsAgentGuardrailsGenerator(tree, { project: 'test-project' }),
      ).rejects.toThrow('Project test-project has no TypeScript Agent');
    });

    it('should throw when the project has several agents and none is named', async () => {
      await addAgent({ name: 'a', infra: 'none' });
      await addAgent({ name: 'b', infra: 'none' });

      await expect(
        tsAgentGuardrailsGenerator(tree, { project: 'test-project' }),
      ).rejects.toThrow(
        'Project test-project has more than one TypeScript Agent. Specify which to guard with --agent. Available agents: a, b',
      );
    });

    it('should throw when the named agent does not exist', async () => {
      await addAgent({ infra: 'none' });

      await expect(
        tsAgentGuardrailsGenerator(tree, {
          project: 'test-project',
          agent: 'nope',
        }),
      ).rejects.toThrow(
        'No TypeScript Agent named nope in project test-project. Available agents: agent',
      );
    });

    it('should guard only the named agent', async () => {
      await addAgent({ name: 'a', infra: 'none' });
      await addAgent({ name: 'b', infra: 'none' });

      await tsAgentGuardrailsGenerator(tree, {
        project: 'test-project',
        agent: 'b',
      });

      expect(tree.exists('apps/test-project/src/b/guardrail.ts')).toBeTruthy();
      expect(tree.exists('apps/test-project/src/a/guardrail.ts')).toBeFalsy();
      expect(
        tree.read('apps/test-project/src/a/agent.ts', 'utf-8'),
      ).not.toContain('getGuardrailedModel');
    });
  });

  describe.each(['http', 'a2a', 'ag-ui'] as const)(
    'protocol %s',
    (protocol) => {
      it.each(['cdk', 'terraform'] as const)(
        'should generate the guardrail with %s',
        async (iac) => {
          await addAgent({ protocol, iac });

          await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

          expect(tree.read(AGENT_FILE, 'utf-8')).toMatchSnapshot('agent.ts');
          expect(
            tree.read(`${AGENT_DIR}/guardrail.ts`, 'utf-8'),
          ).toMatchSnapshot('guardrail.ts');
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
            expect(tree.read(MODULE_FILE, 'utf-8')).toMatchSnapshot('module');
          }
        },
      );

      it('should add the guardrailed model to new Agent', async () => {
        await addAgent({ protocol });
        const indexBefore = tree.read(`${AGENT_DIR}/index.ts`, 'utf-8');

        await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

        const agentTs = tree.read(AGENT_FILE, 'utf-8');
        expect(agentTs).toMatch(
          /new Agent\(\{\s*model: getGuardrailedModel\(\),/,
        );
        expect(agentTs).toContain(
          "import { getGuardrailedModel } from './guardrail.js';",
        );
        expect(agentTs.match(/model:/g)).toHaveLength(1);
        expect(tree.read(`${AGENT_DIR}/index.ts`, 'utf-8')).toBe(indexBefore);
      });

      it('should leave every file unchanged on a second run', async () => {
        await addAgent({ protocol });
        await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });
        const first = changedFiles(tree);
        const warn = vi.spyOn(logger, 'warn');

        await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

        expect(changedFiles(tree)).toEqual(first);
        expect(warn).not.toHaveBeenCalled();
        const components = readProjectConfiguration(tree, 'test-project')
          .metadata.components as { generator: string }[];
        expect(
          components.filter(
            (c) => c.generator === TS_AGENT_GUARDRAILS_GENERATOR_INFO.id,
          ),
        ).toHaveLength(1);
      });
    },
  );

  it('should leave an agent.ts that already sets a model unchanged and say what to add', async () => {
    await addAgent({ infra: 'none' });
    const custom = `import { Agent, BedrockModel } from '@strands-agents/sdk';

export const getAgent = async () => {
  const agent = new Agent({
    model: new BedrockModel({ modelId: 'x' }),
    tools: [],
  });
  return agent;
};
`;
    tree.write(AGENT_FILE, custom);
    const warn = vi.spyOn(logger, 'warn');

    await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

    expect(tree.read(AGENT_FILE, 'utf-8')).toBe(custom);
    expect(tree.exists(`${AGENT_DIR}/guardrail.ts`)).toBeTruthy();
    const messages = warn.mock.calls.map((c) => String(c[0]));
    const modelMessages = messages.filter((m) => m.includes(AGENT_FILE));
    expect(modelMessages).toHaveLength(1);
    expect(modelMessages[0]).toContain('model: getGuardrailedModel()');
    expect(modelMessages[0]).toContain(
      "import { getGuardrailedModel } from './guardrail.js';",
    );
  });

  it('should keep a user edit of guardrail.json on a re-run', async () => {
    await addAgent();
    await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });
    const edited = '{ "blockedInputMessaging": "No." }\n';
    tree.write(`${AGENT_DIR}/guardrail.json`, edited);

    await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

    expect(tree.read(`${AGENT_DIR}/guardrail.json`, 'utf-8')).toBe(edited);
  });

  it('should skip infrastructure and warn when the agent has none', async () => {
    await addAgent({ infra: 'none' });
    const warn = vi.spyOn(logger, 'warn');

    await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

    expect(tree.exists(`${CONSTRUCTS_APP}/guardrails`)).toBeFalsy();
    expect(tree.exists(`${TERRAFORM_APP}/guardrails`)).toBeFalsy();
    expect(tree.exists(`${AGENT_DIR}/guardrail.json`)).toBeTruthy();
    expect(tree.read(AGENT_FILE, 'utf-8')).toContain(
      'model: getGuardrailedModel()',
    );
    const messages = warn.mock.calls.map((c) => String(c[0]));
    const infraMessages = messages.filter((m) =>
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
        await tsAgentGuardrailsGenerator(tree, {
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
        expect(mine).toContain("'agentcore', 'guardrails'");
        expect(mine).toContain('MyAgent: {');
        expect(other).toContain('OtherAgent: {');
      } else {
        expect(mine).toContain('key       = "guardrails"');
        expect(mine).toContain('"MyAgent" =');
        expect(other).toContain('"OtherAgent" =');
      }
      expect(mine).not.toContain('OtherAgent');
      expect(other).not.toContain('MyAgent');
      for (const contents of [mine, other]) {
        expect(contents).not.toContain('GUARDRAIL_ID');
        expect(contents).not.toContain('output "env"');
      }
    },
  );

  it('should add and export the CDK construct, reading the agent policy', async () => {
    await addAgent({ iac: 'cdk' });

    await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

    const construct = tree.read(CONSTRUCT_FILE, 'utf-8');
    expect(construct).toContain('export class TestProjectAgentGuardrail');
    expect(construct).toContain("'apps/test-project/src/agent/guardrail.json'");
    expect(
      tree.read(`${CONSTRUCTS_APP}/guardrails/index.ts`, 'utf-8'),
    ).toContain(
      "export * from './test-project-agent/test-project-agent-guardrail.js';",
    );
    expect(tree.read(`${CONSTRUCTS_APP}/index.ts`, 'utf-8')).toContain(
      "export * from './guardrails/index.js';",
    );
    expect(tree.exists(`${TERRAFORM_APP}/guardrails`)).toBeFalsy();
  });

  it('should export the constructs of two guarded agents from the guardrails barrel', async () => {
    await addAgent({ name: 'my-agent', iac: 'cdk' });
    await addAgent({ name: 'other-agent', iac: 'cdk' });

    await tsAgentGuardrailsGenerator(tree, {
      project: 'test-project',
      agent: 'my-agent',
    });
    await tsAgentGuardrailsGenerator(tree, {
      project: 'test-project',
      agent: 'other-agent',
    });
    const first = changedFiles(tree);
    await tsAgentGuardrailsGenerator(tree, {
      project: 'test-project',
      agent: 'my-agent',
    });

    expect(
      tree.exists(
        `${CONSTRUCTS_APP}/guardrails/my-agent/my-agent-guardrail.ts`,
      ),
    ).toBeTruthy();
    expect(
      tree.exists(
        `${CONSTRUCTS_APP}/guardrails/other-agent/other-agent-guardrail.ts`,
      ),
    ).toBeTruthy();
    const barrel = tree
      .read(`${CONSTRUCTS_APP}/guardrails/index.ts`, 'utf-8')
      .trim()
      .split('\n')
      .sort();
    expect(barrel).toEqual([
      "export * from './my-agent/my-agent-guardrail.js';",
      "export * from './other-agent/other-agent-guardrail.js';",
    ]);
    expect(changedFiles(tree)).toEqual(first);
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
      const callback = await tsAgentGuardrailsGenerator(tree, {
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
        `Add the guardrail to your agent in the root Terraform module where you deploy the agent, for example packages/infra/src/main.tf. Until you add it, the deployed agent fails on its first request, because runtime config has no guardrail at agentcore.guardrails.MyAgent. Add the module "my_agent_guardrail" block as printed below. Add its additional_iam_policy_statements line to your existing module "my_agent" block, and add module.my_agent_guardrail to the depends_on list of your runtime_config_appconfig_deployment module. If your root module does not deploy the agent yet, add the agent's module first, as described in https://awslabs.github.io/nx-plugin-for-aws/en/guides/ts-agent/#infrastructure-as-code.

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
        expect(message).not.toContain('.env');
        expect(message).not.toMatch(/MyAgent|my_agent|my-agent/);
      },
    );

    it.each(['http', 'a2a', 'ag-ui'] as const)(
      'should say a %s agent fails on its first request',
      async (protocol) => {
        await addAgent({ protocol, iac: 'cdk' });

        const [message] = await runAndCaptureInfo();

        expect(message).toContain(
          'Until you add it, the deployed agent fails on its first request, because runtime config has no guardrail at agentcore.guardrails.TestProjectAgent.',
        );
      },
    );

    it('should print the code again on a second run', async () => {
      await addAgent({ iac: 'cdk' });
      const first = await runAndCaptureInfo();

      expect(await runAndCaptureInfo()).toEqual(first);
      expect(first[0]).toContain('TestProjectAgentGuardrail');
    });

    it('should print the code when agent.ts already sets a model and infrastructure was added', async () => {
      await addAgent({ iac: 'cdk' });
      tree.write(
        AGENT_FILE,
        `import { Agent } from '@strands-agents/sdk';
export const getAgent = async () => new Agent({ model: 'x' });
`,
      );
      const warn = vi.spyOn(logger, 'warn');

      const messages = await runAndCaptureInfo();

      expect(
        warn.mock.calls.some((c) => String(c[0]).includes(AGENT_FILE)),
      ).toBeTruthy();
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain('TestProjectAgentGuardrail');
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

    it('should link to a ts#agent guide heading that exists', () => {
      const [, page, anchor] =
        TS_AGENT_TERRAFORM_DEPLOY_GUIDE_URL.match(
          /\/en\/(guides\/[a-z-]+)\/#([a-z-]+)$/,
        ) ?? [];
      const docs = join(GUIDE_FILE, '../../');
      const guide = readFileSync(join(docs, `${page}.mdx`), 'utf-8');
      const snippet = readFileSync(
        join(docs, 'snippets/agent/bedrock-deployment.mdx'),
        'utf-8',
      );

      // The ts#agent guide renders its deployment headings from this snippet.
      const headingSlugs = [...snippet.matchAll(/^#+ (.+)$/gm)].map(([, h]) =>
        h.toLowerCase().replace(/\s+/g, '-'),
      );

      expect(guide).toContain('<Snippet name="agent/bedrock-deployment"');
      expect(headingSlugs).toContain(anchor);
    });
  });

  it('should add the Terraform module, reading the agent policy', async () => {
    await addAgent({ iac: 'terraform' });

    await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

    const module = tree.read(MODULE_FILE, 'utf-8');
    expect(module).toContain(
      '../../../../../../../apps/test-project/src/agent/guardrail.json',
    );
    expect(module).toContain('filesha256(');
    expect(module).toContain('create_before_destroy = true');
    expect(module).toContain('type       = "DENY"');
    expect(module).toContain('"test-project-agent-guardrail"');
    expect(module).toContain('module "add_guardrail_to_runtime_config"');
    expect(module).toContain('source = "../../../core/runtime-config/entry"');
    expect(module).toContain(
      'depends_on = [module.add_guardrail_to_runtime_config]',
    );
    expect(tree.exists(`${CONSTRUCTS_APP}/guardrails`)).toBeFalsy();
  });

  it('should keep a replaced Terraform guardrail version for 15 seconds after the runtime-config deployment', async () => {
    await addAgent({ iac: 'terraform' });

    await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

    // Agents cache their runtime-config entry for 5 seconds. The entry reads
    // the version through the time_sleep, so the deposed sleep (and its
    // 15-second destroy_duration) runs after the runtime-config deployment,
    // and the deposed version is destroyed after the sleep.
    const module = tree.read(MODULE_FILE, 'utf-8');
    expect(module).toContain('source  = "hashicorp/time"');
    expect(module).toContain(`version = "${TERRAFORM_VERSIONS.time}"`);
    expect(module).toMatch(
      /resource "time_sleep" "version_retention" \{\n {2}destroy_duration = "15s"\n\n {2}triggers = \{\n {4}guardrail_id {6}= aws_bedrock_guardrail\.this\.guardrail_id\n {4}guardrail_version = aws_bedrock_guardrail_version\.this\.version\n {2}\}\n\n {2}lifecycle \{\n {4}create_before_destroy = true\n {2}\}\n\}/,
    );
    expect(module).toContain(
      '{ "TestProjectAgent" = { guardrailId = time_sleep.version_retention.triggers.guardrail_id, guardrailVersion = time_sleep.version_retention.triggers.guardrail_version } }',
    );
  });

  it('should vend a policy within the Bedrock guardrail limits', async () => {
    await addAgent({ infra: 'none' });

    await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

    const policy = JSON.parse(
      tree.read(`${AGENT_DIR}/guardrail.json`, 'utf-8'),
    );
    expect(policy.blockedInputMessaging.length).toBeLessThanOrEqual(500);
    expect(policy.blockedOutputsMessaging.length).toBeLessThanOrEqual(500);
    expect(policy.deniedTopics.map((t) => t.name)).toEqual([
      'Investment advice',
    ]);
    for (const topic of policy.deniedTopics) {
      expect(topic.name).toMatch(/^[0-9a-zA-Z-_ !?.]{1,100}$/);
      expect(topic.definition.length).toBeLessThanOrEqual(1000);
      for (const example of topic.examples) {
        expect(example.length).toBeLessThanOrEqual(100);
      }
    }
    expect(policy.piiEntities).toEqual([
      { type: 'EMAIL', action: 'ANONYMIZE' },
      { type: 'PHONE', action: 'ANONYMIZE' },
      { type: 'US_SOCIAL_SECURITY_NUMBER', action: 'BLOCK' },
    ]);
  });

  it('should record the component and the metric', async () => {
    await addAgent({ iac: 'cdk' });

    await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

    expect(
      readProjectConfiguration(tree, 'test-project').metadata.components,
    ).toContainEqual({
      generator: TS_AGENT_GUARDRAILS_GENERATOR_INFO.id,
      name: 'agent',
      path: 'src/agent',
    });
    expect(TS_AGENT_GUARDRAILS_GENERATOR_INFO.id).toBe('ts#agent#guardrails');
    expectHasMetricTags(tree, TS_AGENT_GUARDRAILS_GENERATOR_INFO.metric);
  });

  /**
   * Stand in for the workspace's @<scope>/agent-connection package with the
   * vended runtime-config reader, so guardrail.ts type-checks against the real
   * AgentCoreRuntimeConfig. Only the powertools import is replaced.
   */
  const stubAgentConnection = (): string => {
    const reader = tree
      .read(
        'packages/common/agent-connection/src/core/runtime-config.ts',
        'utf-8',
      )
      .replace(
        /^import \{ getAppConfig \} from '@aws-lambda-powertools\/parameters\/appconfig';$/m,
        'declare const getAppConfig: (...args: unknown[]) => Promise<unknown>;',
      );
    expect(reader).not.toContain('@aws-lambda-powertools');
    const stub = `node_modules/@${getNpmScope(tree)}/agent-connection/index.ts`;
    tree.write(stub, reader);
    return stub;
  };

  it('should generate agent.ts and guardrail.ts that compile (ag-ui)', async () => {
    await addAgent({ protocol: 'ag-ui', infra: 'none' });

    await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

    verifier.expectTypeScriptToCompile(tree, [
      stubAgentConnection(),
      AGENT_FILE,
      `${AGENT_DIR}/guardrail.ts`,
    ]);
  });

  it('should generate a guardrail.ts that compiles (http)', async () => {
    await addAgent({ protocol: 'http', infra: 'none' });

    await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

    verifier.expectTypeScriptToCompile(tree, [
      stubAgentConnection(),
      `${AGENT_DIR}/guardrail.ts`,
    ]);
  });

  describe('synth inputs', () => {
    const policyInput = (agentDir: string) =>
      `{workspaceRoot}/${agentDir}/guardrail.json`;

    const addInfra = (name = 'infra') =>
      tsInfraGenerator(tree, {
        name,
        directory: 'packages',
        preferInstallDependencies: false,
      });

    const infraProjectJson = (root = 'packages/infra') =>
      `${root}/project.json`;

    const synthInputs = (root = 'packages/infra') =>
      readJson(tree, infraProjectJson(root)).targets.synth.inputs;

    it('should add guardrail.json to the synth inputs of the CDK infrastructure', async () => {
      await addInfra();
      await addAgent({ iac: 'cdk' });

      await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

      expect(synthInputs()).toEqual(['default', policyInput(AGENT_DIR)]);
    });

    it("should add each guarded agent's guardrail.json once to every infrastructure project", async () => {
      await addInfra();
      await addInfra('infra-two');
      await addAgent({ name: 'my-agent', iac: 'cdk' });
      await addAgent({ name: 'other-agent', iac: 'cdk' });

      for (let run = 0; run < 2; run++) {
        for (const agent of ['my-agent', 'other-agent']) {
          await tsAgentGuardrailsGenerator(tree, {
            project: 'test-project',
            agent,
          });
        }
      }

      const expected = [
        'default',
        policyInput('apps/test-project/src/my-agent'),
        policyInput('apps/test-project/src/other-agent'),
      ];
      expect(synthInputs()).toEqual(expected);
      expect(synthInputs('packages/infra-two')).toEqual(expected);
    });

    it("should keep the user's synth inputs and add the policy after them", async () => {
      await addInfra();
      updateJson(tree, infraProjectJson(), (config) => {
        config.targets.synth.inputs = [
          'default',
          '{workspaceRoot}/custom.json',
        ];
        return config;
      });
      await addAgent({ iac: 'cdk' });

      await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

      expect(synthInputs()).toEqual([
        'default',
        '{workspaceRoot}/custom.json',
        policyInput(AGENT_DIR),
      ]);
    });

    it('should warn and leave a synth target without inputs unchanged', async () => {
      await addInfra();
      updateJson(tree, infraProjectJson(), (config) => {
        delete config.targets.synth.inputs;
        return config;
      });
      await addAgent({ iac: 'cdk' });
      const warn = vi.spyOn(logger, 'warn');

      await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

      expect(
        readJson(tree, infraProjectJson()).targets.synth,
      ).not.toHaveProperty('inputs');
      const warnings = warn.mock.calls
        .map(([message]) => String(message))
        .filter((message) => message.includes('synth'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('@proj/infra');
      expect(warnings[0]).toContain('packages/infra/project.json');
      expect(warnings[0]).toContain(policyInput(AGENT_DIR));
    });

    it('should not add synth inputs for a Terraform guardrail', async () => {
      await addInfra();
      await addAgent({ iac: 'terraform' });

      await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });

      expect(synthInputs()).toEqual(['default']);
    });
  });
});
