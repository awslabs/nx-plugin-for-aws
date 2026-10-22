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

const generate = async (
  tree: Tree,
  iac: 'cdk' | 'terraform',
  infra: 'agentcore' | 'none',
) => {
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
  await tsAgentGenerator(tree, {
    project: 'test-project',
    infra,
    iac,
    preferInstallDependencies: false,
  });
  await tsAgentGuardrailsGenerator(tree, { project: 'test-project' });
};

describe('guardrail.ts', () => {
  class FakeBedrockModel {
    constructor(public options?: Record<string, unknown>) {}
  }
  let source: string;

  beforeAll(async () => {
    const tree = createTreeUsingTsSolutionSetup();
    await generate(tree, 'cdk', 'none');
    source = tree.read('apps/test-project/src/agent/guardrail.ts', 'utf-8');
  });

  const load = (env: Record<string, string | undefined>) => {
    const warn = vi.fn();
    const { getGuardrailedModel } = evaluate(source, {
      require: (id) => {
        expect(id).toBe('@strands-agents/sdk');
        return { BedrockModel: FakeBedrockModel };
      },
      process: { env },
      console: { warn },
    });
    return { getGuardrailedModel, warn };
  };

  it('should throw when GUARDRAIL_ID is not set outside local dev', () => {
    const { getGuardrailedModel } = load({});
    expect(() => getGuardrailedModel()).toThrow('GUARDRAIL_ID is not set');
  });

  it('should throw when GUARDRAIL_VERSION is not set outside local dev', () => {
    const { getGuardrailedModel } = load({ GUARDRAIL_ID: 'gr-123' });
    expect(() => getGuardrailedModel()).toThrow('GUARDRAIL_VERSION is not set');
  });

  it('should reject the DRAFT version', () => {
    const { getGuardrailedModel } = load({
      GUARDRAIL_ID: 'gr-123',
      GUARDRAIL_VERSION: 'DRAFT',
    });
    expect(() => getGuardrailedModel()).toThrow('GUARDRAIL_VERSION');
  });

  it('should reject the DRAFT version in local dev too', () => {
    const { getGuardrailedModel } = load({
      LOCAL_DEV: 'true',
      GUARDRAIL_ID: 'gr-123',
      GUARDRAIL_VERSION: 'DRAFT',
    });
    expect(() => getGuardrailedModel()).toThrow('GUARDRAIL_VERSION');
  });

  it('should warn once and run without a guardrail in local dev', () => {
    const { getGuardrailedModel, warn } = load({ LOCAL_DEV: 'true' });

    const first = getGuardrailedModel();
    const second = getGuardrailedModel();

    expect(first).toBeInstanceOf(FakeBedrockModel);
    expect(first.options?.guardrailConfig).toBeUndefined();
    expect(second.options?.guardrailConfig).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('GUARDRAIL_ID');
  });

  it('should apply the guardrail from the environment', () => {
    const { getGuardrailedModel, warn } = load({
      GUARDRAIL_ID: 'gr-123',
      GUARDRAIL_VERSION: '2',
    });

    const model = getGuardrailedModel();

    expect(model.options.guardrailConfig).toEqual({
      guardrailIdentifier: 'gr-123',
      guardrailVersion: '2',
      trace: 'enabled',
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('CDK guardrail construct', () => {
  const cdk = realRequire('aws-cdk-lib');
  const iam = realRequire('aws-cdk-lib/aws-iam');
  const { Template } = realRequire('aws-cdk-lib/assertions');
  let source: string;
  let policy: string;
  let workspaceRoot: string;

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
  });

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-'));
    writePolicy(policy);
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  const writePolicy = (contents: string) => {
    fs.mkdirSync(path.dirname(path.join(workspaceRoot, POLICY_PATH)), {
      recursive: true,
    });
    fs.writeFileSync(path.join(workspaceRoot, POLICY_PATH), contents);
  };

  const synth = (props?: Record<string, unknown>) => {
    const { TestProjectAgentGuardrail } = evaluate(source, {
      require: (id) =>
        id === '../../../core/workspace'
          ? { findWorkspaceRoot: () => workspaceRoot }
          : realRequire(id),
    });
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'Stack');
    const guardrail = new TestProjectAgentGuardrail(stack, 'Guardrail', props);
    const role = new iam.Role(stack, 'Role', {
      assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'),
    });
    guardrail.grantApply(role);
    return { stack, guardrail, template: Template.fromStack(stack) };
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

  it('should create a numbered version described by the policy hash', () => {
    const { template } = synth();

    template.resourceCountIs('AWS::Bedrock::GuardrailVersion', 1);
    expect(versionDescription(template)).toBe(
      `guardrail.json sha256 ${sha256(policy)}`,
    );
  });

  it('should grant bedrock:ApplyGuardrail on the guardrail', () => {
    const { stack, guardrail, template } = synth();

    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Action: 'bedrock:ApplyGuardrail',
            Effect: 'Allow',
            Resource: stack.resolve(guardrail.guardrail.attrGuardrailArn),
          },
        ],
      },
    });
  });

  it('should expose the guardrail ID and version as environment variables', () => {
    const { stack, guardrail } = synth();

    expect(stack.resolve(guardrail.environmentVariables)).toEqual({
      GUARDRAIL_ID: stack.resolve(guardrail.guardrail.attrGuardrailId),
      GUARDRAIL_VERSION: stack.resolve(guardrail.version.attrVersion),
    });
    expect(stack.resolve(guardrail.guardrailId)).toEqual(
      stack.resolve(guardrail.guardrail.attrGuardrailId),
    );
    expect(stack.resolve(guardrail.guardrailVersion)).toEqual(
      stack.resolve(guardrail.version.attrVersion),
    );
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
