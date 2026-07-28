/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { type Tree, updateJson } from '@nx/devkit';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { agentcoreHarnessGenerator } from './generator';
import {
  DEFAULT_HARNESS_MODEL_ID,
  DEFAULT_HARNESS_SYSTEM_PROMPT,
} from './resolve-options';

/**
 * CDK Harness template contract tests.
 *
 * These tests assert the rendered construct CONTENT against the pinned
 * `aws-cdk-lib` 2.261.0 `CfnHarness` contract (property names verified
 * against the pinned declarations when the template was implemented).
 *
 * Live compilation and CloudFormation synthesis (requirement 14.5) is
 * deliberately NOT performed in this suite: `aws-cdk-lib` is not a
 * dependency of the plugin itself (it is a centrally pinned version
 * installed into GENERATED workspaces - see `utils/versions.ts`), and the
 * repository has no committed in-tree CDK synth-test pattern (no
 * `aws-cdk-lib/assertions` / `Template.fromStack` usage exists in any
 * plugin spec). Compile and synth coverage for the generated construct is
 * provided by the generated-workspace validation layer (Generator Matrix
 * and smoke tests), which builds real workspaces where the pinned
 * `aws-cdk-lib` is installed. No CloudFormation stack is ever deployed.
 */

const CONSTRUCT_PATH =
  'packages/common/constructs/src/app/harnesses/my-harness/my-harness.ts';
const HARNESSES_INDEX_PATH =
  'packages/common/constructs/src/app/harnesses/index.ts';
const APP_INDEX_PATH = 'packages/common/constructs/src/app/index.ts';

/** The 12 Baseline Permission SIDs from the design, in template order. */
const BASELINE_SIDS = [
  'BedrockModelInvocation',
  'EcrPublicTokenAccess',
  'StsForEcrPublicPull',
  'XRayTracingAccess',
  'CloudWatchLogsGroup',
  'CloudWatchLogsDescribeGroups',
  'CloudWatchLogsStream',
  'CloudWatchMetricsPublish',
  'AgentCoreWorkloadIdentity',
  'AgentCoreBrowserDefault',
  'AgentCoreCodeInterpreterDefault',
  'AgentCoreManagedMemory',
] as const;

interface ParsedStatement {
  actions: string[];
  /** Raw resources expression: an identifier or an array literal. */
  resourcesRaw: string;
  conditionsRaw?: string;
}

/**
 * Parse every `new iam.PolicyStatement({...})` block in the rendered
 * construct into its SID, exact action list, raw resources expression, and
 * raw conditions, so tests can assert exact per-statement content rather
 * than just token presence anywhere in the file.
 */
const parsePolicyStatements = (
  construct: string,
): Record<string, ParsedStatement> => {
  const statements: Record<string, ParsedStatement> = {};
  for (const part of construct.split('new iam.PolicyStatement({').slice(1)) {
    const body = part.split('}),')[0];
    const sid = body.match(/sid: '([^']+)'/)?.[1];
    if (!sid) {
      continue;
    }
    const actionsSection = body.match(/actions: \[([\s\S]*?)\]/)?.[1] ?? '';
    statements[sid] = {
      actions: [...actionsSection.matchAll(/'([^']+)'/g)].map(
        (match) => match[1],
      ),
      resourcesRaw:
        body.match(/resources: (modelResourceArns|\[[\s\S]*?\])/)?.[1] ?? '',
      conditionsRaw: body.match(/conditions: \{([\s\S]*?)\n\s*\}/)?.[1],
    };
  }
  return statements;
};

/** Entries (quoted strings or template literals) of a resources array. */
const resourceEntries = (resourcesRaw: string): string[] =>
  [...resourcesRaw.matchAll(/`[^`]*`|'[^']*'/g)].map((match) => match[0]);

const countOccurrences = (content: string, needle: string): number =>
  content.split(needle).length - 1;

describe('agentcore-harness CDK template contract', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  describe('generated with defaults', () => {
    let construct: string;

    beforeEach(async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });
      construct = tree.read(CONSTRUCT_PATH, 'utf-8')!;
    });

    // Requirements 5.2, 13.4: native CfnHarness from the stable module.
    it('creates the Harness with the stable native CfnHarness resource', () => {
      expect(construct).toContain(
        "import * as agentcore from 'aws-cdk-lib/aws-bedrockagentcore'",
      );
      expect(construct).toContain("new agentcore.CfnHarness(this, 'Harness'");
      // Exactly one Harness resource is created.
      expect(countOccurrences(construct, 'new agentcore.CfnHarness(')).toBe(1);
      // Stable module only - no alpha/preview CDK modules.
      expect(construct).not.toContain('@aws-cdk/aws-bedrock-agentcore-alpha');
    });

    // Requirements 4.8, 5.3, 13.4: lifecycle is delegated to the native
    // resource - no custom resources and no imperative Control Plane calls.
    it('contains no custom resources, Lambda-backed lifecycle, or Control Plane clients', () => {
      // No custom resources ('CustomResource' also catches AwsCustomResource).
      expect(construct).not.toContain('CustomResource');
      expect(construct).not.toContain('custom-resources');
      // No Lambda-backed lifecycle handler.
      expect(construct).not.toContain('aws-lambda');
      // No AWS SDK Control Plane client in the construct.
      expect(construct).not.toContain('@aws-sdk/client-bedrock-agentcore');
      expect(construct).not.toMatch(
        /CreateHarness|GetHarness|UpdateHarness|DeleteHarness|ListHarnesses/,
      );
    });

    // Requirements 3.1, 3.3, 5.1: exact MVP defaults through the pinned
    // native property shapes; omitted limits are omitted properties.
    it('renders the exact defaults through the pinned native prop shapes', () => {
      // model.bedrockModelConfig.modelId per the pinned CfnHarnessProps.
      expect(construct).toMatch(
        new RegExp(
          `model:\\s*\\{\\s*bedrockModelConfig:\\s*\\{\\s*modelId:\\s*'${DEFAULT_HARNESS_MODEL_ID.replace(/\./g, '\\.')}'`,
        ),
      );
      // systemPrompt is a list of text blocks: [{ text: ... }].
      expect(construct).toMatch(
        /systemPrompt:\s*\[\s*\{\s*text:\s*'You are a helpful AI assistant\.'\s*\}\s*,?\s*\]/,
      );
      expect(construct).toContain(DEFAULT_HARNESS_SYSTEM_PROMPT);
      expect(construct).toContain("allowedTools: ['@builtin']");
      // Omitted execution limits are omitted resource properties.
      expect(construct).not.toContain('maxIterations');
      expect(construct).not.toContain('maxTokens');
      expect(construct).not.toContain('timeoutSeconds');
      // IAM inbound authorization is the provider-native default: no custom
      // JWT authorizer configuration is set.
      expect(construct).not.toMatch(/authorizerConfiguration:/);
    });

    // Requirement 3.6: caller-native props are spread after the generated
    // defaults, and harnessName/executionRoleArn are enforced after the
    // spread so the ARN always tracks the exposed executionRole.
    it('spreads caller props after defaults and enforces name/role ARN after the spread', () => {
      const cfnCall = construct.slice(
        construct.indexOf('new agentcore.CfnHarness('),
      );
      expect(cfnCall.length).toBeGreaterThan(0);

      const modelIdx = cfnCall.indexOf('model: {');
      const promptIdx = cfnCall.indexOf('systemPrompt:');
      const toolsIdx = cfnCall.indexOf('allowedTools:');
      const spreadIdx = cfnCall.indexOf('...harnessProps');
      const nameIdx = cfnCall.search(/^\s*harnessName,$/m);
      const roleArnIdx = cfnCall.indexOf(
        'executionRoleArn: this.executionRole.roleArn',
      );

      // All merge participants are present...
      for (const index of [
        modelIdx,
        promptIdx,
        toolsIdx,
        spreadIdx,
        nameIdx,
        roleArnIdx,
      ]) {
        expect(index).toBeGreaterThanOrEqual(0);
      }
      // ...defaults first, then the caller spread, then the enforced props.
      expect(modelIdx).toBeLessThan(spreadIdx);
      expect(promptIdx).toBeLessThan(spreadIdx);
      expect(toolsIdx).toBeLessThan(spreadIdx);
      expect(spreadIdx).toBeLessThan(nameIdx);
      expect(spreadIdx).toBeLessThan(roleArnIdx);
    });

    // Requirement 5.5: a caller-supplied role is used as-is; baseline
    // policies are only attached to the generated role.
    it('uses a supplied execution role without adding baseline policies to it', () => {
      // The supplied role short-circuits generated role creation.
      expect(construct).toMatch(
        /executionRole\s*\?\?\s*new iam\.Role\(this, 'ExecutionRole'/,
      );
      // Baseline statements are guarded on the role being generated.
      const guardIdx = construct.indexOf('if (!executionRole) {');
      expect(guardIdx).toBeGreaterThanOrEqual(0);
      const harnessIdx = construct.indexOf('new agentcore.CfnHarness(');
      // AgentCoreManagedMemory is scoped to the Harness's managed-memory
      // attribute, so it is necessarily added in a second guarded block
      // after the Harness resource exists rather than in the pre-Harness
      // array with the other baseline statements.
      for (const sid of BASELINE_SIDS) {
        if (sid === 'AgentCoreManagedMemory') {
          continue;
        }
        const sidIdx = construct.indexOf(`sid: '${sid}'`);
        expect(sidIdx).toBeGreaterThan(guardIdx);
        expect(sidIdx).toBeLessThan(harnessIdx);
      }
      const memoryGuardIdx = construct.indexOf(
        '!executionRole && harnessProps.memory === undefined',
      );
      expect(memoryGuardIdx).toBeGreaterThan(harnessIdx);
      const memorySidIdx = construct.indexOf("sid: 'AgentCoreManagedMemory'");
      expect(memorySidIdx).toBeGreaterThan(memoryGuardIdx);
      expect(construct).toContain(
        'this.executionRole.addToPrincipalPolicy(statement)',
      );
    });

    // Requirement 7.1: exact service trust with source-account and
    // source-ARN conditions.
    it('trusts bedrock-agentcore.amazonaws.com with SourceAccount and SourceArn conditions', () => {
      expect(construct).toContain(
        "new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com'",
      );
      expect(construct).toMatch(
        /StringEquals:\s*\{\s*'aws:SourceAccount':\s*stack\.account\s*\}/,
      );
      expect(construct).toContain(
        "'aws:SourceArn': `arn:${stack.partition}:bedrock-agentcore:${stack.region}:${stack.account}:*`",
      );
    });

    // Requirements 5.6, 7.2-7.4: all 12 Baseline Permission statements with
    // exact per-SID actions, resource patterns, and conditions.
    it('renders exactly the 12 baseline permission statements with exact contents', () => {
      const statements = parsePolicyStatements(construct);

      // Exactly the 12 design SIDs, in template order, and no other
      // policy statements anywhere in the construct.
      expect(Object.keys(statements)).toEqual([...BASELINE_SIDS]);
      expect(countOccurrences(construct, 'new iam.PolicyStatement(')).toBe(12);

      expect(statements.BedrockModelInvocation.actions).toEqual([
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
      ]);
      // Model access targets the configurable allowlist variable.
      expect(statements.BedrockModelInvocation.resourcesRaw).toBe(
        'modelResourceArns',
      );

      expect(statements.EcrPublicTokenAccess.actions).toEqual([
        'ecr-public:GetAuthorizationToken',
      ]);
      expect(
        resourceEntries(statements.EcrPublicTokenAccess.resourcesRaw),
      ).toEqual(["'*'"]);

      expect(statements.StsForEcrPublicPull.actions).toEqual([
        'sts:GetServiceBearerToken',
      ]);
      expect(
        resourceEntries(statements.StsForEcrPublicPull.resourcesRaw),
      ).toEqual(["'*'"]);

      expect(statements.XRayTracingAccess.actions).toEqual([
        'xray:PutTraceSegments',
        'xray:PutTelemetryRecords',
        'xray:GetSamplingRules',
        'xray:GetSamplingTargets',
      ]);
      expect(
        resourceEntries(statements.XRayTracingAccess.resourcesRaw),
      ).toEqual(["'*'"]);

      expect(statements.CloudWatchLogsGroup.actions).toEqual([
        'logs:CreateLogGroup',
        'logs:DescribeLogStreams',
      ]);
      expect(
        resourceEntries(statements.CloudWatchLogsGroup.resourcesRaw),
      ).toEqual([
        '`arn:${stack.partition}:logs:${stack.region}:${stack.account}:log-group:/aws/bedrock-agentcore/runtimes/*`',
      ]);

      expect(statements.CloudWatchLogsDescribeGroups.actions).toEqual([
        'logs:DescribeLogGroups',
      ]);
      expect(
        resourceEntries(statements.CloudWatchLogsDescribeGroups.resourcesRaw),
      ).toEqual([
        '`arn:${stack.partition}:logs:${stack.region}:${stack.account}:log-group:*`',
      ]);

      expect(statements.CloudWatchLogsStream.actions).toEqual([
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ]);
      expect(
        resourceEntries(statements.CloudWatchLogsStream.resourcesRaw),
      ).toEqual([
        '`arn:${stack.partition}:logs:${stack.region}:${stack.account}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`',
      ]);

      expect(statements.CloudWatchMetricsPublish.actions).toEqual([
        'cloudwatch:PutMetricData',
      ]);
      expect(
        resourceEntries(statements.CloudWatchMetricsPublish.resourcesRaw),
      ).toEqual(["'*'"]);
      expect(statements.CloudWatchMetricsPublish.conditionsRaw).toContain(
        "'cloudwatch:namespace': 'bedrock-agentcore'",
      );

      expect(statements.AgentCoreWorkloadIdentity.actions).toEqual([
        'bedrock-agentcore:GetWorkloadAccessToken',
        'bedrock-agentcore:GetWorkloadAccessTokenForJWT',
      ]);
      expect(
        resourceEntries(statements.AgentCoreWorkloadIdentity.resourcesRaw),
      ).toEqual([
        '`arn:${stack.partition}:bedrock-agentcore:${stack.region}:${stack.account}:workload-identity-directory/default`',
        '`arn:${stack.partition}:bedrock-agentcore:${stack.region}:${stack.account}:workload-identity-directory/default/workload-identity/harness_${harnessName}-*`',
      ]);

      expect(statements.AgentCoreBrowserDefault.actions).toEqual([
        'bedrock-agentcore:StartBrowserSession',
        'bedrock-agentcore:StopBrowserSession',
        'bedrock-agentcore:GetBrowserSession',
        'bedrock-agentcore:ListBrowserSessions',
        'bedrock-agentcore:UpdateBrowserStream',
        'bedrock-agentcore:ConnectBrowserAutomationStream',
        'bedrock-agentcore:ConnectBrowserLiveViewStream',
      ]);
      // AWS-owned default browsers only.
      expect(
        resourceEntries(statements.AgentCoreBrowserDefault.resourcesRaw),
      ).toEqual([
        '`arn:${stack.partition}:bedrock-agentcore:${stack.region}:aws:browser/*`',
      ]);

      expect(statements.AgentCoreCodeInterpreterDefault.actions).toEqual([
        'bedrock-agentcore:StartCodeInterpreterSession',
        'bedrock-agentcore:StopCodeInterpreterSession',
        'bedrock-agentcore:GetCodeInterpreterSession',
        'bedrock-agentcore:ListCodeInterpreterSessions',
        'bedrock-agentcore:InvokeCodeInterpreter',
      ]);
      // AWS-owned default code interpreters only.
      expect(
        resourceEntries(
          statements.AgentCoreCodeInterpreterDefault.resourcesRaw,
        ),
      ).toEqual([
        '`arn:${stack.partition}:bedrock-agentcore:${stack.region}:aws:code-interpreter/*`',
      ]);
    });

    // Requirement 7.2 (defaults of the configurable model allowlist).
    it('defaults modelResourceArns to foundation models and account-scoped Bedrock resources', () => {
      expect(construct).toContain(
        '`arn:${stack.partition}:bedrock:*::foundation-model/*`',
      );
      expect(construct).toContain(
        '`arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:*`',
      );
    });

    // Requirements 7.5, 7.6: no runtime-command permission and no
    // customer-owned optional-resource access in the defaults.
    it('excludes InvokeAgentRuntimeCommand and customer-owned resources from the defaults', () => {
      expect(construct).not.toContain('InvokeAgentRuntimeCommand');
      // Customer-owned optional capabilities remain explicit extensions:
      // these resource/action shapes must not appear in generated defaults.
      expect(construct).not.toContain('browser-custom');
      expect(construct).not.toContain('code-interpreter-custom');
      expect(construct).not.toMatch(/:gateway\//);
      expect(construct).not.toMatch(/:memory\//);
      expect(construct).not.toContain('secretsmanager:');
      expect(construct).not.toContain('ec2:');
      // No wildcard action grants.
      expect(construct).not.toMatch(/actions: \['\*'\]/);
    });

    // Requirements 5.7, 7.7: exposed resource, role, principal, ARN
    // accessor, and least-privilege policy extension point.
    it('exposes the native resource, role, grant principal, ARN accessor, and policy extension', () => {
      expect(construct).toContain(
        'public readonly harness: agentcore.CfnHarness;',
      );
      expect(construct).toContain('public readonly executionRole: iam.IRole;');
      expect(construct).toMatch(
        /public get grantPrincipal\(\): iam\.IPrincipal \{\s*return this\.executionRole\.grantPrincipal;/,
      );
      expect(construct).toMatch(
        /public get harnessArn\(\): string \{\s*return this\.harness\.attrArn;/,
      );
      expect(construct).toContain('public addToRolePolicy(');
      expect(construct).toContain('iam.AddToPrincipalPolicyResult');
      expect(construct).toContain(
        'return this.executionRole.addToPrincipalPolicy(statement);',
      );
    });

    // Requirement 3.4: every pinned native Harness Configuration property
    // is exposed through the extension props surface.
    it('extends the full native props surface without a raw executionRoleArn', () => {
      expect(construct).toContain('export interface MyHarnessProps');
      expect(construct).toContain(
        "extends Partial<Omit<agentcore.CfnHarnessProps, 'executionRoleArn'>>",
      );
      expect(construct).toContain('executionRole?: iam.IRole;');
      expect(construct).toContain('modelResourceArns?: string[];');
      expect(construct).toContain(
        'export class MyHarness extends Construct implements iam.IGrantable',
      );
      expect(construct).toContain(
        'constructor(scope: Construct, id: string, props?: MyHarnessProps)',
      );
    });

    // Requirements 5.8, 7.10: the invocation grant contains exactly the two
    // required actions on only the base Harness ARN.
    it('grantInvokeAccess grants exactly the two invoke actions on the base Harness ARN', () => {
      expect(construct).toContain(
        'public grantInvokeAccess(grantee: iam.IGrantable): iam.Grant',
      );
      expect(construct).toMatch(
        /actions:\s*\[\s*'bedrock-agentcore:InvokeHarness',\s*'bedrock-agentcore:InvokeAgentRuntime',?\s*\]/,
      );
      expect(construct).toContain('resourceArns: [this.harness.attrArn]');
      // No wildcard child-resource grant and no second grant elsewhere.
      expect(construct).not.toContain('attrArn}/');
      expect(construct).not.toContain('attrArn + ');
      expect(
        countOccurrences(construct, "'bedrock-agentcore:InvokeHarness'"),
      ).toBe(1);
      expect(countOccurrences(construct, 'iam.Grant.addToPrincipal(')).toBe(1);
    });

    // Requirement 5.9: the Runtime Configuration merge preserves sibling
    // agentcore.harnesses entries (spread of the existing map).
    it('merges the Harness ARN into agentcore.harnesses preserving existing entries', () => {
      expect(construct).toContain('RuntimeConfig.ensure(this)');
      expect(construct).toMatch(
        /rc\.set\('agentcore', 'harnesses', \{\s*\.\.\.rc\.get\('agentcore'\)\.harnesses,\s*MyHarness:\s*this\.harness\.attrArn,?\s*\}\)/,
      );
      // Only one runtime configuration write for this harness.
      expect(countOccurrences(construct, 'rc.set(')).toBe(1);
    });

    // Requirement 5.4: collision-resistant, service-safe default name.
    it('keeps the 39-char unique name with underscore separator and H-prefix fallback', () => {
      expect(construct).toContain(
        "import { CfnOutput, Names, Stack } from 'aws-cdk-lib'",
      );
      expect(construct).toContain('Names.uniqueResourceName(this, {');
      // 39 + the conditionally applied leading 'H' stays within the
      // 40-character Harness Name limit.
      expect(construct).toContain('maxLength: 39');
      expect(construct).toContain("separator: '_'");
      expect(construct).toContain("allowedSpecialCharacters: '_'");
      // The letter-leading guarantee: H-prefix when the path-derived name
      // does not start with a letter, and caller overrides still win.
      expect(construct).toContain('harnessProps.harnessName ??');
      expect(construct).toContain('/^[A-Za-z]/.test(uniqueName)');
      expect(construct).toContain('`H${uniqueName}`');
    });
  });

  describe('custom execution limits', () => {
    // Requirement 3.2: each supplied positive limit is configured on the
    // native resource; omitted limits stay omitted independently.
    it('renders only the supplied limit as a literal and omits the others', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
        maxTokens: 2048,
      });

      const construct = tree.read(CONSTRUCT_PATH, 'utf-8')!;
      expect(construct).toContain('maxTokens: 2048');
      expect(construct).not.toContain('maxIterations');
      expect(construct).not.toContain('timeoutSeconds');

      // The rendered limit is part of the generated defaults, so the caller
      // spread can still override it.
      const cfnCall = construct.slice(
        construct.indexOf('new agentcore.CfnHarness('),
      );
      expect(cfnCall.indexOf('maxTokens: 2048')).toBeGreaterThanOrEqual(0);
      expect(cfnCall.indexOf('maxTokens: 2048')).toBeLessThan(
        cfnCall.indexOf('...harnessProps'),
      );
    });

    it('renders all supplied limits as literals', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
        maxIterations: 7,
        maxTokens: 2048,
        timeoutSeconds: 120,
      });

      const construct = tree.read(CONSTRUCT_PATH, 'utf-8')!;
      expect(construct).toContain('maxIterations: 7');
      expect(construct).toContain('maxTokens: 2048');
      expect(construct).toContain('timeoutSeconds: 120');
    });
  });

  describe('long names', () => {
    const LONG_NAME =
      'very-long-agentcore-harness-name-that-comfortably-exceeds-the-forty-character-harness-name-limit';
    const LONG_CLASS_NAME =
      'VeryLongAgentcoreHarnessNameThatComfortablyExceedsTheFortyCharacterHarnessNameLimit';
    const LONG_CONSTRUCT_PATH = `packages/common/constructs/src/app/harnesses/${LONG_NAME}/${LONG_NAME}.ts`;

    // Requirement 5.4: the deployed-name safety net (39-char unique name +
    // H-prefix) is present, and generation itself renders a well-formed
    // construct for names far beyond the 40-character service limit. The
    // truncated deployed name is produced at synth time and is validated by
    // the generated-workspace synth layer.
    it('renders a well-formed construct with the name-safety logic for a very long name', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: LONG_NAME,
        iac: 'cdk',
      });

      expect(tree.exists(LONG_CONSTRUCT_PATH)).toBe(true);
      const construct = tree.read(LONG_CONSTRUCT_PATH, 'utf-8')!;

      expect(construct).toContain(`export class ${LONG_CLASS_NAME}`);
      expect(construct).toMatch(
        new RegExp(
          `export class ${LONG_CLASS_NAME}\\s+extends Construct\\s+implements iam\\.IGrantable`,
        ),
      );
      expect(construct).toContain(`interface ${LONG_CLASS_NAME}Props`);
      expect(construct).toMatch(
        new RegExp(`${LONG_CLASS_NAME}:\\s*this\\.harness\\.attrArn`),
      );

      // The name-safety net is independent of the human name's length.
      expect(construct).toContain('maxLength: 39');
      expect(construct).toContain('/^[A-Za-z]/.test(uniqueName)');
      expect(construct).toContain('`H${uniqueName}`');

      // The construct is exported through the harnesses index.
      expect(tree.read(HARNESSES_INDEX_PATH, 'utf-8')).toContain(
        `export * from './${LONG_NAME}/${LONG_NAME}.js'`,
      );
    });
  });

  describe('module formats', () => {
    // Requirement 5.11: ESM workspaces use .js-suffixed relative imports.
    it('esm workspace (default): renders .js-suffixed relative imports and exports', async () => {
      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });

      const construct = tree.read(CONSTRUCT_PATH, 'utf-8')!;
      expect(construct).toContain(
        "import { RuntimeConfig } from '../../../core/runtime-config.js'",
      );

      expect(tree.read(HARNESSES_INDEX_PATH, 'utf-8')).toContain(
        "export * from './my-harness/my-harness.js'",
      );
      expect(tree.read(APP_INDEX_PATH, 'utf-8')).toContain(
        "export * from './harnesses/index.js'",
      );
    });

    // Requirement 5.11: CommonJS workspaces resolve relative imports
    // extensionless, so the RuntimeConfig import and both star exports
    // drop the .js suffix.
    it('cjs workspace: renders extensionless relative imports and exports', async () => {
      // A CommonJS workspace is marked with an explicit type: 'commonjs'.
      updateJson(tree, 'package.json', (pkg) => ({
        ...pkg,
        type: 'commonjs',
      }));

      await agentcoreHarnessGenerator(tree, {
        name: 'my-harness',
        iac: 'cdk',
      });

      const construct = tree.read(CONSTRUCT_PATH, 'utf-8')!;
      expect(construct).toContain(
        "import { RuntimeConfig } from '../../../core/runtime-config'",
      );
      expect(construct).not.toContain('core/runtime-config.js');

      const harnessesIndex = tree.read(HARNESSES_INDEX_PATH, 'utf-8')!;
      expect(harnessesIndex).toContain(
        "export * from './my-harness/my-harness'",
      );
      expect(harnessesIndex).not.toContain('my-harness.js');

      const appIndex = tree.read(APP_INDEX_PATH, 'utf-8')!;
      expect(appIndex).toContain("export * from './harnesses/index'");
      expect(appIndex).not.toContain('harnesses/index.js');
    });
  });
});
