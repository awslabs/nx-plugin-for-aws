/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {
  addProjectConfiguration,
  type Tree,
  updateJson,
  writeJson,
} from '@nx/devkit';
import { ts } from '@ts-morph/bootstrap';
import { getNpmScope } from '../../../utils/npm-scope.js';
import { createTreeUsingTsSolutionSetup } from '../../../utils/test.js';
import { tsAgentGenerator } from '../generator.js';
import { tsAgentGuardrailsGenerator } from './generator.js';

const POLICY_PATH = 'apps/test-project/src/agent/guardrail.json';
const CONSTRUCT_FILE =
  'packages/common/constructs/src/app/guardrails/test-project-agent/test-project-agent-guardrail.ts';

const realRequire = createRequire(import.meta.url);

/** Transpile a generated TypeScript file to CommonJS and evaluate it. */
const evaluate = (
  source: string,
  globals: {
    require: (id: string) => unknown;
    process?: { env: Record<string, string | undefined> };
    console?: Pick<Console, 'warn'>;
  },
): Record<string, any> => {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} as Record<string, any> };
  new Function(
    'require',
    'module',
    'exports',
    '__filename',
    'process',
    'console',
    outputText,
  )(
    globals.require,
    module,
    module.exports,
    path.join(os.tmpdir(), 'construct.js'),
    globals.process ?? process,
    globals.console ?? console,
  );
  return module.exports;
};

const addTestProject = (tree: Tree) => {
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
};

const generate = async (
  tree: Tree,
  iac: 'cdk' | 'terraform',
  infra: 'agentcore' | 'none',
) => {
  addTestProject(tree);
  await tsAgentGenerator(tree, {
    project: 'test-project',
    infra,
    iac,
    preferInstallDependencies: false,
  });
  await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });
};

/** Generate two guarded agents, `my-agent` and `other-agent`, in one project. */
const generateTwo = async (
  tree: Tree,
  iac: 'cdk' | 'terraform',
  infra: 'agentcore' | 'none',
) => {
  addTestProject(tree);
  for (const name of ['my-agent', 'other-agent']) {
    await tsAgentGenerator(tree, {
      project: 'test-project',
      name,
      infra,
      iac,
      preferInstallDependencies: false,
    });
    await tsAgentGuardrailsGenerator(tree, {
      project: 'test-project',
      agent: name,
    });
  }
};

describe('guardrail.ts', () => {
  /** Stands in for the Strands BedrockModel: stream yields the guardrail it would send. */
  class FakeBedrockModel {
    config: Record<string, any>;
    constructor(config: Record<string, any> = {}) {
      this.config = config;
    }
    updateConfig(config: Record<string, any>) {
      this.config = { ...this.config, ...config };
    }
    async *stream(_messages: unknown[]) {
      yield this.config.guardrailConfig;
    }
  }
  let source: string;
  let twoAgentSources: Record<string, string>;
  let agentConnection: string;

  beforeAll(async () => {
    const tree = createTreeUsingTsSolutionSetup();
    await generate(tree, 'cdk', 'none');
    source = tree.read('apps/test-project/src/agent/guardrail.ts', 'utf-8');
    agentConnection = `@${getNpmScope(tree)}/agent-connection`;

    const two = createTreeUsingTsSolutionSetup();
    await generateTwo(two, 'cdk', 'none');
    twoAgentSources = Object.fromEntries(
      ['my-agent', 'other-agent'].map((name) => [
        name,
        two.read(`apps/test-project/src/${name}/guardrail.ts`, 'utf-8'),
      ]),
    );
  });

  const load = (
    env: Record<string, string | undefined>,
    readConfig: () => Promise<unknown>,
    guardrailSource = source,
  ) => {
    const warn = vi.fn();
    const getAgentCoreRuntimeConfig = vi.fn(readConfig);
    const { getGuardrailedModel } = evaluate(guardrailSource, {
      require: (id) => {
        if (id === '@strands-agents/sdk') {
          return { BedrockModel: FakeBedrockModel };
        }
        expect(id).toBe(agentConnection);
        return { getAgentCoreRuntimeConfig };
      },
      process: { env },
      console: { warn },
    });
    return { getGuardrailedModel, getAgentCoreRuntimeConfig, warn };
  };

  /** The guardrail config the model sends on its next model call. */
  const firstEvent = async (model: any) =>
    (await model.stream([]).next()).value;

  const entry = (guardrailId: string, guardrailVersion: string) => ({
    guardrails: { TestProjectAgent: { guardrailId, guardrailVersion } },
  });

  it('should build the model synchronously and read runtime config only when it streams', () => {
    const { getGuardrailedModel, getAgentCoreRuntimeConfig } = load({}, () =>
      Promise.resolve(entry('gr-123', '2')),
    );

    const model = getGuardrailedModel();

    expect(model).toBeInstanceOf(FakeBedrockModel);
    expect(getAgentCoreRuntimeConfig).not.toHaveBeenCalled();
    expect(source).not.toContain('GUARDRAIL_ID');
  });

  it('should apply the guardrail from runtime config', async () => {
    const { getGuardrailedModel, warn } = load({}, () =>
      Promise.resolve(entry('gr-123', '2')),
    );

    expect(await firstEvent(getGuardrailedModel())).toEqual({
      guardrailIdentifier: 'gr-123',
      guardrailVersion: '2',
      trace: 'enabled',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('should apply a changed version on the next model call of the same model', async () => {
    const versions = ['2', '3'];
    const { getGuardrailedModel } = load({}, () =>
      Promise.resolve(entry('gr-123', versions.shift() ?? '3')),
    );
    const model = getGuardrailedModel();

    expect((await firstEvent(model)).guardrailVersion).toBe('2');
    expect((await firstEvent(model)).guardrailVersion).toBe('3');
  });

  it('should fail the model call when runtime config has no entry for the agent outside local dev', async () => {
    const { getGuardrailedModel } = load({}, () =>
      Promise.resolve({ agentRuntimes: {} }),
    );

    await expect(firstEvent(getGuardrailedModel())).rejects.toThrow(
      'No guardrail for this agent in runtime config at agentcore.guardrails.TestProjectAgent. Add the TestProjectAgentGuardrail construct (CDK) or the guardrails/test-project-agent module (Terraform) to your infrastructure.',
    );
  });

  it('should pass on an error reading runtime config outside local dev', async () => {
    const { getGuardrailedModel } = load({}, () =>
      Promise.reject(new Error('RUNTIME_CONFIG_APP_ID is not set')),
    );

    await expect(firstEvent(getGuardrailedModel())).rejects.toThrow(
      'RUNTIME_CONFIG_APP_ID is not set',
    );
  });

  it('should warn once and run without a guardrail in local dev without RUNTIME_CONFIG_APP_ID', async () => {
    const { getGuardrailedModel, getAgentCoreRuntimeConfig, warn } = load(
      { LOCAL_DEV: 'true' },
      () => Promise.resolve(entry('gr-123', '2')),
    );
    const model = getGuardrailedModel();

    expect(await firstEvent(model)).toBeUndefined();
    expect(await firstEvent(model)).toBeUndefined();
    expect(getAgentCoreRuntimeConfig).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(
      'agentcore.guardrails.TestProjectAgent',
    );
  });

  it('should apply the deployed guardrail in local dev with RUNTIME_CONFIG_APP_ID', async () => {
    const { getGuardrailedModel, warn } = load(
      { LOCAL_DEV: 'true', RUNTIME_CONFIG_APP_ID: 'app-id' },
      () => Promise.resolve(entry('gr-123', '2')),
    );

    expect(await firstEvent(getGuardrailedModel())).toEqual({
      guardrailIdentifier: 'gr-123',
      guardrailVersion: '2',
      trace: 'enabled',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('should warn once and run without a guardrail in local dev when runtime config cannot be read', async () => {
    const { getGuardrailedModel, warn } = load(
      { LOCAL_DEV: 'true', RUNTIME_CONFIG_APP_ID: 'app-id' },
      () => Promise.reject(new Error('Could not load credentials')),
    );
    const model = getGuardrailedModel();

    expect(await firstEvent(model)).toBeUndefined();
    expect(await firstEvent(model)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['outside local dev', {}],
    ['in local dev', { LOCAL_DEV: 'true', RUNTIME_CONFIG_APP_ID: 'app-id' }],
  ])('should reject the DRAFT version %s', async (_, env) => {
    const { getGuardrailedModel } = load(env, () =>
      Promise.resolve(entry('gr-123', 'DRAFT')),
    );

    await expect(firstEvent(getGuardrailedModel())).rejects.toThrow(
      'must be a numbered guardrail version, but is DRAFT',
    );
  });

  it('should read each agent its own runtime-config key', async () => {
    const config = {
      guardrails: {
        MyAgent: { guardrailId: 'gr-my', guardrailVersion: '1' },
        OtherAgent: { guardrailId: 'gr-other', guardrailVersion: '4' },
      },
    };
    const mine = load(
      {},
      () => Promise.resolve(config),
      twoAgentSources['my-agent'],
    );
    const other = load(
      {},
      () => Promise.resolve(config),
      twoAgentSources['other-agent'],
    );

    expect(await firstEvent(mine.getGuardrailedModel())).toMatchObject({
      guardrailIdentifier: 'gr-my',
      guardrailVersion: '1',
    });
    expect(await firstEvent(other.getGuardrailedModel())).toMatchObject({
      guardrailIdentifier: 'gr-other',
      guardrailVersion: '4',
    });
  });
});

describe('CDK guardrail construct', () => {
  const cdk = realRequire('aws-cdk-lib');
  const iam = realRequire('aws-cdk-lib/aws-iam');
  const { Match, Template } = realRequire('aws-cdk-lib/assertions');
  let source: string;
  let policy: string;
  let twoAgentSources: Record<string, string>;
  let runtimeConfig: Record<string, any>;
  let workspaceRoot: string;

  const MY_AGENT_POLICY = 'apps/test-project/src/my-agent/guardrail.json';
  const OTHER_AGENT_POLICY = 'apps/test-project/src/other-agent/guardrail.json';

  beforeAll(async () => {
    const tree = createTreeUsingTsSolutionSetup();
    // CommonJS rendering, so the transpiled construct needs no import.meta.
    updateJson(tree, 'package.json', (json) => ({
      ...json,
      type: 'commonjs',
    }));
    await generate(tree, 'cdk', 'agentcore');
    source = tree.read(CONSTRUCT_FILE, 'utf-8');
    policy = tree.read(POLICY_PATH, 'utf-8');
    // One RuntimeConfig class shared by every construct, as in a real app.
    runtimeConfig = evaluate(
      tree.read(
        'packages/common/constructs/src/core/runtime-config.ts',
        'utf-8',
      ),
      { require: realRequire },
    );

    const two = createTreeUsingTsSolutionSetup();
    updateJson(two, 'package.json', (json) => ({
      ...json,
      type: 'commonjs',
    }));
    await generateTwo(two, 'cdk', 'agentcore');
    twoAgentSources = Object.fromEntries(
      ['my-agent', 'other-agent'].map((name) => [
        name,
        two.read(
          `packages/common/constructs/src/app/guardrails/${name}/${name}-guardrail.ts`,
          'utf-8',
        ),
      ]),
    );
  });

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-'));
    writePolicy(policy);
    writePolicy(policy, MY_AGENT_POLICY);
    writePolicy(policy, OTHER_AGENT_POLICY);
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  const writePolicy = (contents: string, policyPath = POLICY_PATH) => {
    fs.mkdirSync(path.dirname(path.join(workspaceRoot, policyPath)), {
      recursive: true,
    });
    fs.writeFileSync(path.join(workspaceRoot, policyPath), contents);
  };

  const evaluateConstruct = (constructSource: string) =>
    evaluate(constructSource, {
      require: (id) => {
        if (id === '../../../core/workspace') {
          return { findWorkspaceRoot: () => workspaceRoot };
        }
        if (id === '../../../core/runtime-config') {
          return runtimeConfig;
        }
        return realRequire(id);
      },
    });

  const newStack = () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'Stack');
    const role = new iam.Role(stack, 'Role', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });
    // The agent construct does this, which creates the AppConfig resources.
    runtimeConfig.RuntimeConfig.ensure(stack).grantReadAppConfig(role);
    return { stack, role };
  };

  const synth = (props?: Record<string, unknown>) => {
    const { TestProjectAgentGuardrail } = evaluateConstruct(source);
    const { stack, role } = newStack();
    const guardrail = new TestProjectAgentGuardrail(stack, 'Guardrail', {
      agent: role,
      ...props,
    });
    return { stack, role, guardrail, template: Template.fromStack(stack) };
  };

  const synthTwo = () => {
    const { MyAgentGuardrail } = evaluateConstruct(twoAgentSources['my-agent']);
    const { OtherAgentGuardrail } = evaluateConstruct(
      twoAgentSources['other-agent'],
    );
    const { stack, role } = newStack();
    const mine = new MyAgentGuardrail(stack, 'MyAgentGuardrail', {
      agent: role,
    });
    const other = new OtherAgentGuardrail(stack, 'OtherAgentGuardrail', {
      agent: role,
    });
    return { stack, mine, other, template: Template.fromStack(stack) };
  };

  /** The resolved `agentcore` hosted configuration content, as written to AppConfig. */
  const agentcoreContent = (template: any): any => {
    const [profileId] = Object.entries(
      template.findResources('AWS::AppConfig::ConfigurationProfile'),
    ).find(([, r]: [string, any]) => r.Properties.Name === 'agentcore') as [
      string,
      any,
    ];
    const version = Object.values(
      template.findResources('AWS::AppConfig::HostedConfigurationVersion'),
    ).find(
      (r: any) => r.Properties.ConfigurationProfileId.Ref === profileId,
    ) as any;
    return version.Properties.Content;
  };

  /** The logical ID of the only resource of a type whose ID starts with a prefix. */
  const logicalId = (template: any, type: string, prefix: string): string => {
    const ids = Object.keys(template.findResources(type)).filter((id) =>
      id.startsWith(prefix),
    );
    expect(ids).toHaveLength(1);
    return ids[0];
  };

  /** Rebuild the JSON string AppConfig receives, with GetAtt tokens as text. */
  const contentJson = (content: any): any => {
    const text =
      typeof content === 'string'
        ? content
        : content['Fn::Join'][1]
            .map((part: any) =>
              typeof part === 'string'
                ? part
                : `<${part['Fn::GetAtt'].join('.')}>`,
            )
            .join('');
    return JSON.parse(text);
  };

  const versionDescription = (template: any): string =>
    Object.values(template.findResources('AWS::Bedrock::GuardrailVersion')).map(
      (r: any) => r.Properties.Description,
    )[0];

  const sha256 = (contents: string) =>
    createHash('sha256').update(contents).digest('hex');

  it('should declare the guardrail from guardrail.json', () => {
    const { template } = synth();

    template.resourceCountIs('AWS::Bedrock::Guardrail', 1);
    const [guardrail] = Object.values(
      template.findResources('AWS::Bedrock::Guardrail'),
    ) as any[];
    const parsed = JSON.parse(policy);
    expect(guardrail.Properties.BlockedInputMessaging).toBe(
      parsed.blockedInputMessaging,
    );
    expect(guardrail.Properties.BlockedOutputsMessaging).toBe(
      parsed.blockedOutputsMessaging,
    );
    expect(guardrail.Properties.Name).toMatch(/^[0-9a-zA-Z-_]{1,50}$/);
    expect(guardrail.Properties.TopicPolicyConfig.TopicsConfig).toEqual([
      {
        Name: 'Investment advice',
        Definition: parsed.deniedTopics[0].definition,
        Examples: parsed.deniedTopics[0].examples,
        Type: 'DENY',
      },
    ]);
    expect(
      guardrail.Properties.SensitiveInformationPolicyConfig.PiiEntitiesConfig,
    ).toEqual([
      { Type: 'EMAIL', Action: 'ANONYMIZE' },
      { Type: 'PHONE', Action: 'ANONYMIZE' },
      { Type: 'US_SOCIAL_SECURITY_NUMBER', Action: 'BLOCK' },
    ]);
  });

  it('should create a numbered version described by the policy hash alone when only the agent is passed', () => {
    const { template } = synth();

    template.resourceCountIs('AWS::Bedrock::GuardrailVersion', 1);
    expect(versionDescription(template)).toBe(
      `guardrail.json sha256 ${sha256(policy)}`,
    );
  });

  const applyGuardrailStatement = (stack: any, guardrail: any) => ({
    Action: 'bedrock:ApplyGuardrail',
    Effect: 'Allow',
    Resource: stack.resolve(guardrail.guardrail.attrGuardrailArn),
  });

  it('should grant the agent bedrock:ApplyGuardrail on the guardrail', () => {
    const { stack, guardrail, template } = synth();

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([applyGuardrailStatement(stack, guardrail)]),
      },
    });
  });

  it('should grant another principal with grantApply', () => {
    const { TestProjectAgentGuardrail } = evaluateConstruct(source);
    const { stack, role } = newStack();
    const guardrail = new TestProjectAgentGuardrail(stack, 'Guardrail', {
      agent: role,
    });
    const other = new iam.Role(stack, 'OtherRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    guardrail.grantApply(other);

    const policies =
      Template.fromStack(stack).findResources('AWS::IAM::Policy');
    const otherPolicy = Object.values(policies).find((p: any) =>
      JSON.stringify(p.Properties.Roles).includes('OtherRole'),
    ) as any;
    expect(otherPolicy.Properties.PolicyDocument.Statement).toEqual([
      applyGuardrailStatement(stack, guardrail),
    ]);
  });

  it('should write the guardrail ID and version to runtime config', () => {
    const { template } = synth();
    const guardrailId = logicalId(
      template,
      'AWS::Bedrock::Guardrail',
      'Guardrail',
    );
    const versionId = logicalId(
      template,
      'AWS::Bedrock::GuardrailVersion',
      'GuardrailVersion',
    );

    expect(contentJson(agentcoreContent(template)).guardrails).toEqual({
      TestProjectAgent: {
        guardrailId: `<${guardrailId}.GuardrailId>`,
        guardrailVersion: `<${versionId}.Version>`,
      },
    });
  });

  it('should write two agents to different runtime-config keys', () => {
    const { template } = synthTwo();
    const ref = (type: string, prefix: string, attr: string) =>
      `<${logicalId(template, type, prefix)}.${attr}>`;

    expect(contentJson(agentcoreContent(template)).guardrails).toEqual({
      MyAgent: {
        guardrailId: ref(
          'AWS::Bedrock::Guardrail',
          'MyAgentGuardrail',
          'GuardrailId',
        ),
        guardrailVersion: ref(
          'AWS::Bedrock::GuardrailVersion',
          'MyAgentGuardrailVersion',
          'Version',
        ),
      },
      OtherAgent: {
        guardrailId: ref(
          'AWS::Bedrock::Guardrail',
          'OtherAgentGuardrail',
          'GuardrailId',
        ),
        guardrailVersion: ref(
          'AWS::Bedrock::GuardrailVersion',
          'OtherAgentGuardrailVersion',
          'Version',
        ),
      },
    });
  });

  it("should change only the edited agent's version description", () => {
    const descriptions = (template: any) =>
      Object.fromEntries(
        Object.entries(
          template.findResources('AWS::Bedrock::GuardrailVersion'),
        ).map(([id, r]: [string, any]) => [
          id.startsWith('MyAgent') ? 'mine' : 'other',
          r.Properties.Description,
        ]),
      );
    const before = descriptions(synthTwo().template);
    const parsed = JSON.parse(policy);
    parsed.deniedTopics = [];
    writePolicy(JSON.stringify(parsed, null, 2), MY_AGENT_POLICY);

    const after = descriptions(synthTwo().template);

    expect(after.mine).not.toBe(before.mine);
    expect(after.other).toBe(before.other);
  });

  it('should not expose environment variables', () => {
    const { guardrail } = synth();

    expect('environmentVariables' in guardrail).toBe(false);
  });

  it('should change the version description when a topic changes', () => {
    const before = versionDescription(synth().template);
    const parsed = JSON.parse(policy);
    parsed.deniedTopics[0].definition = 'Advice about buying shares.';
    const edited = JSON.stringify(parsed, null, 2);
    writePolicy(edited);

    const after = versionDescription(synth().template);

    expect(after).not.toBe(before);
    expect(after).toBe(`guardrail.json sha256 ${sha256(edited)}`);
  });

  it('should change the version description when props override the rules', () => {
    const before = versionDescription(synth().template);

    const { template } = synth({
      contentPolicyConfig: {
        filtersConfig: [
          { type: 'HATE', inputStrength: 'HIGH', outputStrength: 'HIGH' },
        ],
      },
    });

    expect(versionDescription(template)).not.toBe(before);
    template.hasResourceProperties('AWS::Bedrock::Guardrail', {
      ContentPolicyConfig: {
        FiltersConfig: [
          { Type: 'HATE', InputStrength: 'HIGH', OutputStrength: 'HIGH' },
        ],
      },
    });
  });
});
