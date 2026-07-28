/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 8: Default IAM output preserves the security boundary
 * Validates: Requirements 5.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 13.7
 *
 * For all valid model-resource allowlists and both IaC Providers, generated
 * default Execution Role policies grant the reviewed Baseline Permissions
 * only on the modeled resource scopes and exclude
 * `bedrock-agentcore:InvokeAgentRuntimeCommand` plus unconfigured
 * customer-resource capabilities; for all CDK Invocation Principals, the
 * invocation grant contains exactly `InvokeHarness` plus `InvokeAgentRuntime`
 * on the base Harness ARN and no child wildcard.
 *
 * The IAM content of both rendered templates is static per generated
 * Harness - only the caller-supplied model-resource allowlist varies what
 * the deployed policy grants. Each provider is therefore rendered ONCE (one
 * full generator run each) and the rendered IAM logic is extracted from the
 * output and compiled into directly evaluable form:
 *
 * - CDK: the `modelResourceArns` destructuring default, the ExecutionRole
 *   trust declaration, the baseline `iam.PolicyStatement` array, and the
 *   `grantInvokeAccess` grant call are extracted from the rendered
 *   construct source and evaluated as real JavaScript against recording
 *   fakes (an `iam.PolicyStatement`'s props map 1:1 onto policy JSON with
 *   Effect defaulting to Allow) plus shared sentinel
 *   `stack.partition/region/account` and deployed-name values.
 * - Terraform: the `assume_role_policy`/`policy` jsonencode arguments and
 *   the `model_resource_arns` local fallback are extracted anchored from
 *   the rendered module, `${local.*}` interpolations are replaced by the
 *   same sentinels, and the HCL object syntax is converted to JavaScript
 *   and evaluated (with `concat` provided and the empty
 *   additional-statements arm inlined as `[]`, its rendered default).
 *
 * The property then drives 100+ generated model-resource allowlists (ARNs
 * across partitions, foundation models, inference profiles, account-scoped
 * patterns, 0-5 entries, or omitted) through BOTH providers' real
 * configuration points - the CDK destructuring default (applies only when
 * the prop is `undefined`) and the Terraform `var != null ? var : default`
 * local (applies only when the variable is `null`) - and asserts each
 * normalized trust document and 12-statement baseline equals the reviewed
 * design table and the other provider's output. Evaluating pre-rendered
 * logic keeps each of the 100+ runs to sub-millisecond cost.
 */
import fc from 'fast-check';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { agentcoreHarnessGenerator } from './generator';
import { resolveAgentcoreHarnessOptions } from './resolve-options';

// ---------------------------------------------------------------------------
// Shared sentinels. Both providers' deployment-scope references normalize to
// these placeholder values so the two outputs are directly comparable.
// None of them may contain ':' (ARN account-segment checks split on ':'),
// '"', '\\', or '${' (they are substituted into extracted source text).
// ---------------------------------------------------------------------------

const PARTITION = '<partition>';
const REGION = '<region>';
const ACCOUNT = '<account-id>';
const DEPLOYED_NAME = '<deployed-harness-name>';
const HARNESS_ATTR_ARN = '<harness-attr-arn-token>';
const MEMORY_ATTR_ARN = '<harness-attr-memory-arn-token>';

/** CDK `stack` sentinel mirroring the `Stack.of(this)` references. */
const STACK = {
  partition: PARTITION,
  region: REGION,
  account: ACCOUNT,
} as const;

// ---------------------------------------------------------------------------
// Model: the reviewed security boundary from the design, restated literally.
// ---------------------------------------------------------------------------

interface NormalizedStatement {
  Sid: string;
  Effect: string;
  Action: string[];
  Resource: string[];
  Condition?: Record<string, Record<string, string>>;
}

/** Requirement 7.2: the shared default model allowlist of both providers. */
const EXPECTED_DEFAULT_MODEL_RESOURCES: readonly string[] = [
  `arn:${PARTITION}:bedrock:*::foundation-model/*`,
  `arn:${PARTITION}:bedrock:${REGION}:${ACCOUNT}:*`,
];

/** Requirement 7.1: the exact trust statement from the design. */
const EXPECTED_TRUST = {
  Effect: 'Allow',
  Principal: { Service: 'bedrock-agentcore.amazonaws.com' },
  Action: ['sts:AssumeRole'],
  Condition: {
    StringEquals: { 'aws:SourceAccount': ACCOUNT },
    ArnLike: {
      'aws:SourceArn': `arn:${PARTITION}:bedrock-agentcore:${REGION}:${ACCOUNT}:*`,
    },
  },
};

/**
 * Requirements 7.2-7.4: the 12 reviewed Baseline Permission statements from
 * the design table, in template order, parameterized only by the effective
 * model-resource allowlist.
 */
const expectedBaseline = (
  modelResources: readonly string[],
): NormalizedStatement[] => [
  {
    Sid: 'BedrockModelInvocation',
    Effect: 'Allow',
    Action: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
    Resource: [...modelResources],
  },
  {
    Sid: 'EcrPublicTokenAccess',
    Effect: 'Allow',
    Action: ['ecr-public:GetAuthorizationToken'],
    Resource: ['*'],
  },
  {
    Sid: 'StsForEcrPublicPull',
    Effect: 'Allow',
    Action: ['sts:GetServiceBearerToken'],
    Resource: ['*'],
  },
  {
    Sid: 'XRayTracingAccess',
    Effect: 'Allow',
    Action: [
      'xray:PutTraceSegments',
      'xray:PutTelemetryRecords',
      'xray:GetSamplingRules',
      'xray:GetSamplingTargets',
    ],
    Resource: ['*'],
  },
  {
    Sid: 'CloudWatchLogsGroup',
    Effect: 'Allow',
    Action: ['logs:CreateLogGroup', 'logs:DescribeLogStreams'],
    Resource: [
      `arn:${PARTITION}:logs:${REGION}:${ACCOUNT}:log-group:/aws/bedrock-agentcore/runtimes/*`,
    ],
  },
  {
    Sid: 'CloudWatchLogsDescribeGroups',
    Effect: 'Allow',
    Action: ['logs:DescribeLogGroups'],
    Resource: [`arn:${PARTITION}:logs:${REGION}:${ACCOUNT}:log-group:*`],
  },
  {
    Sid: 'CloudWatchLogsStream',
    Effect: 'Allow',
    Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
    Resource: [
      `arn:${PARTITION}:logs:${REGION}:${ACCOUNT}:log-group:/aws/bedrock-agentcore/runtimes/*:log-stream:*`,
    ],
  },
  {
    Sid: 'CloudWatchMetricsPublish',
    Effect: 'Allow',
    Action: ['cloudwatch:PutMetricData'],
    Resource: ['*'],
    Condition: {
      StringEquals: { 'cloudwatch:namespace': 'bedrock-agentcore' },
    },
  },
  {
    Sid: 'AgentCoreWorkloadIdentity',
    Effect: 'Allow',
    Action: [
      'bedrock-agentcore:GetWorkloadAccessToken',
      'bedrock-agentcore:GetWorkloadAccessTokenForJWT',
    ],
    Resource: [
      `arn:${PARTITION}:bedrock-agentcore:${REGION}:${ACCOUNT}:workload-identity-directory/default`,
      `arn:${PARTITION}:bedrock-agentcore:${REGION}:${ACCOUNT}:workload-identity-directory/default/workload-identity/harness_${DEPLOYED_NAME}-*`,
    ],
  },
  {
    Sid: 'AgentCoreManagedMemory',
    Effect: 'Allow',
    Action: [
      'bedrock-agentcore:CreateEvent',
      'bedrock-agentcore:DeleteEvent',
      'bedrock-agentcore:GetEvent',
      'bedrock-agentcore:ListEvents',
      'bedrock-agentcore:RetrieveMemoryRecords',
    ],
    Resource: [
      `arn:${PARTITION}:bedrock-agentcore:${REGION}:${ACCOUNT}:memory/harness_*`,
    ],
  },
  {
    Sid: 'AgentCoreBrowserDefault',
    Effect: 'Allow',
    Action: [
      'bedrock-agentcore:StartBrowserSession',
      'bedrock-agentcore:StopBrowserSession',
      'bedrock-agentcore:GetBrowserSession',
      'bedrock-agentcore:ListBrowserSessions',
      'bedrock-agentcore:UpdateBrowserStream',
      'bedrock-agentcore:ConnectBrowserAutomationStream',
      'bedrock-agentcore:ConnectBrowserLiveViewStream',
    ],
    Resource: [`arn:${PARTITION}:bedrock-agentcore:${REGION}:aws:browser/*`],
  },
  {
    Sid: 'AgentCoreCodeInterpreterDefault',
    Effect: 'Allow',
    Action: [
      'bedrock-agentcore:StartCodeInterpreterSession',
      'bedrock-agentcore:StopCodeInterpreterSession',
      'bedrock-agentcore:GetCodeInterpreterSession',
      'bedrock-agentcore:ListCodeInterpreterSessions',
      'bedrock-agentcore:InvokeCodeInterpreter',
    ],
    Resource: [
      `arn:${PARTITION}:bedrock-agentcore:${REGION}:aws:code-interpreter/*`,
    ],
  },
];

/**
 * Requirements 7.5, 7.6: action/resource shapes that must never appear in
 * generator-introduced default output. The caller-controlled model
 * allowlist is masked before scanning because requirement 7.2 makes that
 * list explicitly configurable.
 */
const PROHIBITED_FRAGMENTS = [
  'InvokeAgentRuntimeCommand',
  'browser-custom',
  'code-interpreter-custom',
  ':gateway/',
  'secretsmanager:',
  'ec2:',
] as const;

/**
 * The default managed-memory grant (AgentCoreManagedMemory) is scoped to
 * the harness_*-prefixed memory ARN, so a blanket ':memory/' fragment check
 * would also flag that legitimate default. Any OTHER, unscoped memory
 * resource pattern would indicate a BYO/customer-owned memory grant leaking
 * into the defaults.
 */
const PROHIBITED_MEMORY_PATTERN = /:memory\/(?!harness_\*)/;

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

/** Slice one balanced `open`...`close` region starting at `startIndex`. */
const balancedSlice = (
  text: string,
  startIndex: number,
  open: string,
  close: string,
): string => {
  if (text[startIndex] !== open) {
    throw new Error(`expected '${open}' at extraction start`);
  }
  let depth = 0;
  for (let i = startIndex; i < text.length; i++) {
    if (text[i] === open) {
      depth++;
    } else if (text[i] === close) {
      depth--;
      if (depth === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }
  throw new Error(`unbalanced '${open}${close}' region in rendered output`);
};

const mustIndexOf = (
  text: string,
  needle: string,
  description: string,
  fromIndex = 0,
): number => {
  const index = text.indexOf(needle, fromIndex);
  if (index < 0) {
    throw new Error(`${description} not found in rendered output`);
  }
  return index;
};

/** Copy a possibly scalar Action/Resource value as a string array. */
const asStringArray = (value: unknown, label: string): string[] => {
  const array = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : undefined;
  if (
    array === undefined ||
    !array.every((entry) => typeof entry === 'string')
  ) {
    throw new Error(`${label} is not a string or list of strings`);
  }
  return [...array] as string[];
};

const countOccurrences = (content: string, needle: string): number =>
  content.split(needle).length - 1;

// ---------------------------------------------------------------------------
// CDK extraction: compile the rendered construct's IAM logic into directly
// evaluable functions. Generated ARN lists are always passed as VALUES into
// the compiled functions, never concatenated into source text.
// ---------------------------------------------------------------------------

/** Records `new iam.PolicyStatement(props)`; props map 1:1 to policy JSON. */
class FakePolicyStatement {
  constructor(readonly props: Record<string, unknown>) {}
}

/** Records `new iam.ServicePrincipal(service, opts)`. */
class FakeServicePrincipal {
  constructor(
    readonly service: string,
    readonly opts: Record<string, unknown>,
  ) {}
}

/** Records `new iam.Role(scope, id, props)`. */
class FakeRole {
  constructor(
    readonly scope: unknown,
    readonly id: string,
    readonly props: Record<string, unknown>,
  ) {}
}

interface CompiledCdk {
  construct: string;
  /** The real `const { ..., modelResourceArns = [...] } = props ?? {}`. */
  destructure: (props: Record<string, unknown>) => {
    executionRole: unknown;
    modelResourceArns: unknown;
    harnessProps: Record<string, unknown>;
  };
  /** The real generated `new iam.Role(this, 'ExecutionRole', {...})`. */
  role: () => FakeRole;
  /** The real baseline `iam.PolicyStatement` array. */
  statements: (modelResourceArns: string[]) => FakePolicyStatement[];
  /** The real `iam.Grant.addToPrincipal({...})` call of grantInvokeAccess. */
  grant: (grantee: unknown) => Record<string, unknown>;
}

const compileCdk = (construct: string): CompiledCdk => {
  // The destructuring statement carrying the modelResourceArns default.
  const destructureStart = mustIndexOf(
    construct,
    'const {',
    'options destructuring',
  );
  const destructureMarker = '} = props ?? {};';
  const destructureEnd = mustIndexOf(
    construct,
    destructureMarker,
    'options destructuring end',
  );
  const destructureText = construct.slice(
    destructureStart,
    destructureEnd + destructureMarker.length,
  );
  const destructureFn = new Function(
    'props',
    'stack',
    `${destructureText}\nreturn { executionRole, modelResourceArns, harnessProps };`,
  ) as (
    props: Record<string, unknown>,
    stack: typeof STACK,
  ) => {
    executionRole: unknown;
    modelResourceArns: unknown;
    harnessProps: Record<string, unknown>;
  };

  // The generated ExecutionRole declaration (trust policy).
  const roleStart = mustIndexOf(
    construct,
    "new iam.Role(this, 'ExecutionRole',",
    'generated ExecutionRole',
  );
  const roleArgs = balancedSlice(
    construct,
    construct.indexOf('(', roleStart),
    '(',
    ')',
  );
  const roleFn = new Function(
    'iam',
    'stack',
    `return new iam.Role${roleArgs};`,
  ) as (this: unknown, iam: unknown, stack: typeof STACK) => FakeRole;

  // The baseline statement array inside the generated-role guard.
  const guardIndex = mustIndexOf(
    construct,
    'if (!executionRole) {',
    'baseline-permission guard',
  );
  const arrayStart = construct.indexOf('[', guardIndex);
  const statementsArray = balancedSlice(construct, arrayStart, '[', ']');
  if (
    !construct
      .slice(arrayStart + statementsArray.length)
      .startsWith('.forEach(')
  ) {
    throw new Error(
      'baseline statements array does not feed the addToPrincipalPolicy forEach',
    );
  }
  const statementsFn = new Function(
    'iam',
    'stack',
    'modelResourceArns',
    'harnessName',
    `return ${statementsArray};`,
  ) as (
    iam: unknown,
    stack: typeof STACK,
    modelResourceArns: string[],
    harnessName: string,
  ) => FakePolicyStatement[];

  // The managed-memory statement, added in a second guarded block after
  // the Harness resource exists (it references the Harness's
  // service-generated managed-memory attribute, so it cannot join the
  // pre-Harness baseline array above).
  const memoryGuardIndex = mustIndexOf(
    construct,
    '!executionRole && harnessProps.memory === undefined',
    'managed-memory guard',
  );
  const memoryStatementStart = mustIndexOf(
    construct,
    'new iam.PolicyStatement({',
    'managed-memory statement',
    memoryGuardIndex,
  );
  const memoryStatementArgs = balancedSlice(
    construct,
    construct.indexOf('(', memoryStatementStart),
    '(',
    ')',
  );
  const memoryStatementFn = new Function(
    'iam',
    `return new iam.PolicyStatement${memoryStatementArgs};`,
  ) as (this: unknown, iam: unknown) => FakePolicyStatement;

  // The grantInvokeAccess grant call.
  const grantStart = mustIndexOf(
    construct,
    'iam.Grant.addToPrincipal(',
    'invocation grant',
  );
  const grantArgs = balancedSlice(
    construct,
    construct.indexOf('(', grantStart),
    '(',
    ')',
  );
  const grantFn = new Function(
    'iam',
    'grantee',
    `return iam.Grant.addToPrincipal${grantArgs};`,
  ) as (
    this: unknown,
    iam: unknown,
    grantee: unknown,
  ) => Record<string, unknown>;

  return {
    construct,
    destructure: (props) => destructureFn(props, STACK),
    role: () =>
      roleFn.call(
        {},
        { Role: FakeRole, ServicePrincipal: FakeServicePrincipal },
        STACK,
      ),
    statements: (modelResourceArns) => [
      ...statementsFn(
        { PolicyStatement: FakePolicyStatement },
        STACK,
        modelResourceArns,
        DEPLOYED_NAME,
      ),
      memoryStatementFn.call(
        {
          harness: { attrMemoryManagedMemoryConfigurationArn: MEMORY_ATTR_ARN },
        },
        { PolicyStatement: FakePolicyStatement },
      ),
    ],
    grant: (grantee) =>
      grantFn.call(
        { harness: { attrArn: HARNESS_ATTR_ARN } },
        {
          Grant: { addToPrincipal: (props: Record<string, unknown>) => props },
        },
        grantee,
      ),
  };
};

// ---------------------------------------------------------------------------
// Terraform extraction: substitute `${local.*}` interpolations with the
// shared sentinels, convert the jsonencode HCL object syntax to JavaScript,
// and compile. Bare references (`local.account_id`,
// `local.model_resource_arns`) stay as property accesses on a bound
// `local` parameter, preserving the rendered reference structure.
// ---------------------------------------------------------------------------

const TF_REF_SENTINELS: ReadonlyArray<readonly [string, string]> = [
  ['partition', PARTITION],
  ['region', REGION],
  ['account_id', ACCOUNT],
  ['harness_name', DEPLOYED_NAME],
];

const substituteTfRefs = (text: string): string =>
  TF_REF_SENTINELS.reduce(
    (current, [ref, sentinel]) =>
      current.replaceAll(`\${local.${ref}}`, sentinel),
    text,
  );

/**
 * Convert one extracted HCL object expression (a jsonencode argument) to a
 * JavaScript object expression: `key = value` attribute separators become
 * `key: value`, and the newline attribute separators gain the commas
 * JavaScript requires (JS tolerates the resulting trailing commas inside
 * literals). Quoted HCL keys are already valid JS object keys.
 */
const hclObjectToJs = (hcl: string): string => {
  if (hcl.includes('${')) {
    throw new Error('unsubstituted interpolation in extracted HCL');
  }
  // Strip standalone `#` comment lines (explanatory documentation on
  // individual statements) before conversion - they carry no policy
  // semantics and are not valid JavaScript.
  const uncommented = hcl
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  const keyed = uncommented.replace(
    /^(\s*)([A-Za-z_]\w*|"[^"]+")\s*=\s*/gm,
    '$1$2: ',
  );
  return keyed
    .split('\n')
    .map((line) => {
      const trimmed = line.trimEnd();
      return trimmed === '' || /[{[(,]$/.test(trimmed)
        ? trimmed
        : `${trimmed},`;
    })
    .join('\n')
    .replace(/,\s*$/, '');
};

interface TfPolicyDocument {
  Version: string;
  Statement: Array<Record<string, unknown>>;
}

interface CompiledTf {
  module: string;
  /** The real `var != null ? var : [defaults]` local fallback. */
  resolveModelResourceArns: (supplied: string[] | null) => string[];
  /** The real `assume_role_policy = jsonencode({...})` document. */
  trustDocument: () => TfPolicyDocument;
  /** The real `policy = jsonencode({...})` baseline document. */
  policyDocument: (modelResourceArns: string[]) => TfPolicyDocument;
}

const compileTf = (module: string): CompiledTf => {
  // The configurable model-allowlist local: null falls back to the shared
  // default; any non-null supplied set (including empty) is used as-is.
  const localAnchor =
    'model_resource_arns = var.model_resource_arns != null ? var.model_resource_arns : [';
  const localIndex = mustIndexOf(
    module,
    localAnchor,
    'model_resource_arns local fallback',
  );
  const defaultList = balancedSlice(
    module,
    localIndex + localAnchor.length - 1,
    '[',
    ']',
  );
  const localFn = new Function(
    'varS',
    `return (${substituteTfRefs(
      `var.model_resource_arns != null ? var.model_resource_arns : ${defaultList}`,
    ).replaceAll('var.', 'varS.')});`,
  ) as (varS: { model_resource_arns: string[] | null }) => string[];

  // The trust document.
  const trustIndex = mustIndexOf(
    module,
    'assume_role_policy = jsonencode(',
    'assume-role policy',
  );
  const trustArg = balancedSlice(
    module,
    module.indexOf('(', trustIndex),
    '(',
    ')',
  ).slice(1, -1);
  const trustFn = new Function(
    'local',
    `return (${hclObjectToJs(substituteTfRefs(trustArg))});`,
  ) as (local: { account_id: string }) => TfPolicyDocument;

  // The baseline policy document. The additional-statements concat arm is
  // required to exist (requirement 7.7) and is inlined as `[]`, exactly
  // what its rendered `default = []` variable contributes here.
  const policyIndex = mustIndexOf(
    module,
    '\n  policy = jsonencode(',
    'execution-role policy',
  );
  const policyArg = balancedSlice(
    module,
    module.indexOf('(', policyIndex),
    '(',
    ')',
  ).slice(1, -1);
  if (
    !policyArg.includes(
      'for statement in var.additional_execution_role_policy_statements',
    )
  ) {
    throw new Error(
      'additional_execution_role_policy_statements is not wired into the policy',
    );
  }
  const extensionArmCut = policyArg.replace(/\], \[[\s\S]*?\]\)/, '], [])');
  if (extensionArmCut === policyArg) {
    throw new Error('additional-statements concat arm not found in the policy');
  }
  const policyFn = new Function(
    'local',
    'concat',
    `return (${hclObjectToJs(substituteTfRefs(extensionArmCut))});`,
  ) as (
    local: { account_id: string; model_resource_arns: string[] },
    concat: (a: unknown[], b: unknown[]) => unknown[],
  ) => TfPolicyDocument;
  const concat = (a: unknown[], b: unknown[]): unknown[] => [...a, ...b];

  return {
    module,
    resolveModelResourceArns: (supplied) =>
      localFn({ model_resource_arns: supplied }),
    trustDocument: () => trustFn({ account_id: ACCOUNT }),
    policyDocument: (modelResourceArns) =>
      policyFn(
        { account_id: ACCOUNT, model_resource_arns: modelResourceArns },
        concat,
      ),
  };
};

// ---------------------------------------------------------------------------
// Normalization to one comparable statement shape.
// ---------------------------------------------------------------------------

const CDK_STATEMENT_PROPS = new Set([
  'sid',
  'actions',
  'resources',
  'conditions',
]);

const normalizeCdkStatements = (
  recorded: FakePolicyStatement[],
): NormalizedStatement[] =>
  recorded.map((statement) => {
    if (!(statement instanceof FakePolicyStatement)) {
      throw new Error('non-PolicyStatement entry in the baseline array');
    }
    const props = statement.props;
    for (const key of Object.keys(props)) {
      // Any other prop (effect, principals, notActions, ...) would change
      // the 1:1 props-to-policy-JSON mapping this normalization relies on.
      if (!CDK_STATEMENT_PROPS.has(key)) {
        throw new Error(`unexpected PolicyStatement prop '${key}'`);
      }
    }
    return {
      Sid: String(props.sid),
      // iam.PolicyStatement defaults the effect to Allow; the props carry
      // no effect override (checked above).
      Effect: 'Allow',
      Action: asStringArray(props.actions, `actions of ${String(props.sid)}`),
      Resource: asStringArray(
        props.resources,
        `resources of ${String(props.sid)}`,
      ),
      ...(props.conditions !== undefined
        ? { Condition: props.conditions as NormalizedStatement['Condition'] }
        : {}),
    };
  });

const TF_STATEMENT_KEYS = new Set([
  'Sid',
  'Effect',
  'Action',
  'Resource',
  'Condition',
]);

const normalizeTfStatements = (
  statements: Array<Record<string, unknown>>,
): NormalizedStatement[] =>
  statements.map((statement) => {
    for (const key of Object.keys(statement)) {
      if (!TF_STATEMENT_KEYS.has(key)) {
        throw new Error(`unexpected policy statement key '${key}'`);
      }
    }
    return {
      Sid: String(statement.Sid),
      Effect: String(statement.Effect),
      Action: asStringArray(
        statement.Action,
        `Action of ${String(statement.Sid)}`,
      ),
      Resource: asStringArray(
        statement.Resource,
        `Resource of ${String(statement.Sid)}`,
      ),
      ...(statement.Condition !== undefined
        ? { Condition: statement.Condition as NormalizedStatement['Condition'] }
        : {}),
    };
  });

/**
 * Serialized scan surface for the prohibited-fragment check: everything the
 * generator introduced, with the caller-controlled model allowlist masked
 * (requirement 7.2 makes that list caller configuration, not a default).
 */
const generatorIntroducedSurface = (
  trust: unknown,
  statements: NormalizedStatement[],
): string =>
  JSON.stringify([
    trust,
    statements.map((statement) =>
      statement.Sid === 'BedrockModelInvocation'
        ? { ...statement, Resource: '<caller-controlled>' }
        : statement,
    ),
  ]);

// ---------------------------------------------------------------------------
// Arbitraries: model-resource allowlists across partitions and resource
// shapes. Entries are unique because the Terraform variable is a
// `set(string)`, so duplicate entries are outside the shared cross-provider
// semantic space. `undefined` models the omitted configuration (CDK prop
// absent / Terraform variable left at its `null` default).
// ---------------------------------------------------------------------------

const LOWER_ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

const arbPartition = fc.constantFrom('aws', 'aws-cn', 'aws-us-gov');
const arbRegion = fc.constantFrom(
  'us-east-1',
  'us-west-2',
  'eu-central-1',
  'ap-southeast-2',
  'cn-north-1',
  'us-gov-west-1',
);
const arbAccount = fc.string({
  unit: fc.constantFrom(...'0123456789'.split('')),
  minLength: 12,
  maxLength: 12,
});
const arbResourceId = fc.string({
  unit: fc.constantFrom(...`${LOWER_ALNUM}.-`.split('')),
  minLength: 1,
  maxLength: 24,
});

const arbModelResourceArn = fc.oneof(
  // A foundation model in one region (foundation models have no account).
  fc
    .tuple(arbPartition, arbRegion, arbResourceId)
    .map(([p, r, id]) => `arn:${p}:bedrock:${r}::foundation-model/${id}`),
  // The cross-region foundation-model wildcard (the default's own shape).
  arbPartition.map((p) => `arn:${p}:bedrock:*::foundation-model/*`),
  // An account-scoped inference profile.
  fc
    .tuple(arbPartition, arbRegion, arbAccount, arbResourceId)
    .map(
      ([p, r, a, id]) => `arn:${p}:bedrock:${r}:${a}:inference-profile/${id}`,
    ),
  // An account-scoped application inference profile.
  fc
    .tuple(arbPartition, arbRegion, arbAccount, arbResourceId)
    .map(
      ([p, r, a, id]) =>
        `arn:${p}:bedrock:${r}:${a}:application-inference-profile/${id}`,
    ),
  // Every Bedrock resource of one account and region.
  fc
    .tuple(arbPartition, arbRegion, arbAccount)
    .map(([p, r, a]) => `arn:${p}:bedrock:${r}:${a}:*`),
);

/** 0-5 unique entries, or `undefined` for the omitted configuration. */
const arbModelResourceList = fc.option(
  fc.uniqueArray(arbModelResourceArn, { minLength: 0, maxLength: 5 }),
  { nil: undefined },
);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('agentcore-harness default IAM boundary (Property 8)', () => {
  let cdk: CompiledCdk;
  let tf: CompiledTf;

  beforeAll(async () => {
    // The IAM logic of both templates is static per generated Harness, so
    // one full generator run per provider renders everything the property
    // evaluates; the 100+ runs then vary only the evaluation inputs.
    const cdkTree = createTreeUsingTsSolutionSetup();
    const kebab = resolveAgentcoreHarnessOptions(cdkTree, {
      name: 'iam-boundary',
    }).nameKebabCase;
    await agentcoreHarnessGenerator(cdkTree, {
      name: 'iam-boundary',
      iac: 'cdk',
    });
    const construct = cdkTree.read(
      `packages/common/constructs/src/app/harnesses/${kebab}/${kebab}.ts`,
      'utf-8',
    );
    expect(construct).not.toBeNull();
    cdk = compileCdk(construct as string);

    const tfTree = createTreeUsingTsSolutionSetup();
    await agentcoreHarnessGenerator(tfTree, {
      name: 'iam-boundary',
      iac: 'terraform',
    });
    const module = tfTree.read(
      `packages/common/terraform/src/app/harnesses/${kebab}/${kebab}.tf`,
      'utf-8',
    );
    expect(module).not.toBeNull();
    tf = compileTf(module as string);
  });

  // Feature: agentcore-harness-generator, Property 8: Default IAM output preserves the security boundary
  // **Validates: Requirements 5.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 13.7**
  it('renders the reviewed trust and 12-statement baseline for all model-resource allowlists on both providers', () => {
    fc.assert(
      fc.property(arbModelResourceList, (modelResourceList) => {
        // --- The effective allowlist through both real configuration
        // points (7.2): the CDK destructuring default applies only when
        // the prop is undefined; the Terraform local applies only when
        // the variable is null. A supplied empty list stays empty.
        const cdkResolved = cdk.destructure(
          modelResourceList === undefined
            ? {}
            : { modelResourceArns: [...modelResourceList] },
        ).modelResourceArns as string[];
        const tfResolved = tf.resolveModelResourceArns(
          modelResourceList === undefined ? null : [...modelResourceList],
        );
        const expectedModelResources =
          modelResourceList ?? EXPECTED_DEFAULT_MODEL_RESOURCES;
        expect(cdkResolved).toEqual(expectedModelResources);
        expect(tfResolved).toEqual(expectedModelResources);

        // --- Trust (7.1): identical principal, action, and conditions.
        const role = cdk.role();
        expect(Object.keys(role.props)).toEqual(['assumedBy']);
        const principal = role.props.assumedBy as FakeServicePrincipal;
        expect(principal).toBeInstanceOf(FakeServicePrincipal);
        // Only `conditions` is configured, so the CDK default assume-role
        // action (sts:AssumeRole) applies.
        expect(Object.keys(principal.opts)).toEqual(['conditions']);
        const cdkTrust = {
          Effect: 'Allow',
          Principal: { Service: principal.service },
          Action: ['sts:AssumeRole'],
          Condition: principal.opts.conditions,
        };

        const tfTrustDocument = tf.trustDocument();
        expect(Object.keys(tfTrustDocument).sort()).toEqual([
          'Statement',
          'Version',
        ]);
        expect(tfTrustDocument.Version).toBe('2012-10-17');
        expect(tfTrustDocument.Statement).toHaveLength(1);
        const rawTfTrust = tfTrustDocument.Statement[0];
        const tfTrust = {
          ...rawTfTrust,
          Action: asStringArray(rawTfTrust.Action, 'trust Action'),
        };

        expect(cdkTrust).toEqual(EXPECTED_TRUST);
        expect(tfTrust).toEqual(EXPECTED_TRUST);

        // --- Baseline statements (7.2-7.4, 13.7): each provider's
        // normalized output equals the reviewed design table (SIDs,
        // actions, resources, conditions, order) and the other provider's.
        const rawCdkStatements = normalizeCdkStatements(
          cdk.statements([...cdkResolved]),
        );
        const tfPolicyDocument = tf.policyDocument([...tfResolved]);
        expect(tfPolicyDocument.Version).toBe('2012-10-17');
        const tfStatements = normalizeTfStatements(tfPolicyDocument.Statement);

        const expected = expectedBaseline(expectedModelResources);

        // AgentCoreManagedMemory's Resource is only known once the Harness
        // is synthesized (a CFN attribute token on the CDK side), unlike
        // Terraform's static harness_*-prefixed ARN pattern. Assert the CDK
        // side really uses that attribute token, then normalize it to the
        // reviewed static pattern so the cross-provider structural
        // comparison below still validates every other field exactly.
        const cdkMemoryStatement = rawCdkStatements.find(
          (statement) => statement.Sid === 'AgentCoreManagedMemory',
        );
        expect(cdkMemoryStatement?.Resource).toEqual([MEMORY_ATTR_ARN]);
        const cdkStatements = rawCdkStatements.map((statement) =>
          statement.Sid === 'AgentCoreManagedMemory'
            ? {
                ...statement,
                Resource: expected.find(
                  (e) => e.Sid === 'AgentCoreManagedMemory',
                )!.Resource,
              }
            : statement,
        );
        // AgentCoreManagedMemory is necessarily positioned differently
        // between providers: CDK adds it in a second guarded block after
        // the Harness resource exists (its Resource is a Harness attribute
        // token unavailable pre-synthesis), while Terraform inlines it in
        // the main statement list. Exact per-provider order (including that
        // divergence) is covered by cdk-template.spec.ts and
        // terraform-template.spec.ts; here, compare content irrespective of
        // that one structurally-forced position difference.
        const bySid = (statements: NormalizedStatement[]) =>
          [...statements].sort((a, b) => a.Sid.localeCompare(b.Sid));
        expect(bySid(cdkStatements)).toEqual(bySid(expected));
        expect(bySid(tfStatements)).toEqual(bySid(expected));
        expect(bySid(cdkStatements)).toEqual(bySid(tfStatements));

        // --- Ownership boundary (7.4, 7.6): default Browser and Code
        // Interpreter access targets AWS-owned resources (owner segment
        // `aws`), while workload identity stays in the deployment account.
        for (const statements of [cdkStatements, tfStatements]) {
          for (const sid of [
            'AgentCoreBrowserDefault',
            'AgentCoreCodeInterpreterDefault',
          ]) {
            const statement = statements.find((s) => s.Sid === sid);
            expect(statement).toBeDefined();
            for (const resource of (statement as NormalizedStatement)
              .Resource) {
              expect(resource.split(':')[4]).toBe('aws');
            }
          }
          const workloadIdentity = statements.find(
            (s) => s.Sid === 'AgentCoreWorkloadIdentity',
          ) as NormalizedStatement;
          for (const resource of workloadIdentity.Resource) {
            expect(resource.split(':')[4]).toBe(ACCOUNT);
          }
          // No wildcard action grant anywhere in the baseline.
          for (const statement of statements) {
            for (const action of statement.Action) {
              expect(action).not.toBe('*');
            }
          }
        }

        // --- Exclusions (7.5, 7.6): no runtime-command permission and no
        // customer-owned optional-resource shapes anywhere in the
        // generator-introduced trust or baseline output.
        for (const surface of [
          generatorIntroducedSurface(cdkTrust, cdkStatements),
          generatorIntroducedSurface(tfTrust, tfStatements),
        ]) {
          for (const fragment of PROHIBITED_FRAGMENTS) {
            expect(surface).not.toContain(fragment);
          }
          expect(surface).not.toMatch(PROHIBITED_MEMORY_PATTERN);
        }
      }),
      // At least 100 runs required; evaluation of pre-rendered logic keeps
      // each run sub-millisecond.
      { numRuns: 200 },
    );
  });

  // Feature: agentcore-harness-generator, Property 8: Default IAM output preserves the security boundary
  // **Validates: Requirements 5.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 13.7**
  it('grants exactly the two invoke actions on the base Harness ARN for all Invocation Principals', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 24 }), (label) => {
        const grantee = { grantPrincipal: label };
        const grant = cdk.grant(grantee);

        // 5.8: exactly the two required actions, only the base Harness
        // ARN (the untouched attrArn token - no child wildcard, no
        // concatenated suffix), the grantee passed through unchanged, and
        // nothing else in the grant.
        expect(Object.keys(grant).sort()).toEqual([
          'actions',
          'grantee',
          'resourceArns',
        ]);
        expect(grant.grantee).toBe(grantee);
        expect(grant.actions).toEqual([
          'bedrock-agentcore:InvokeHarness',
          'bedrock-agentcore:InvokeAgentRuntime',
        ]);
        expect(grant.resourceArns).toEqual([HARNESS_ATTR_ARN]);
        expect((grant.resourceArns as string[])[0]).toBe(HARNESS_ATTR_ARN);
      }),
      // At least 100 runs required.
      { numRuns: 200 },
    );
  });

  // Feature: agentcore-harness-generator, Property 8: Default IAM output preserves the security boundary
  // **Validates: Requirements 5.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 13.7**
  it('exposes the least-privilege extension points and IAM inbound authorization on both providers', () => {
    // 7.7: the CDK policy extension method.
    expect(cdk.construct).toContain('public addToRolePolicy(');
    expect(cdk.construct).toContain('iam.AddToPrincipalPolicyResult');
    expect(cdk.construct).toContain(
      'return this.executionRole.addToPrincipalPolicy(statement);',
    );

    // 7.7: the Terraform structured extension variable, wired into the
    // rendered policy (the wiring itself is also asserted at compile time).
    expect(tf.module).toContain(
      'variable "additional_execution_role_policy_statements"',
    );
    expect(tf.module).toContain(
      'for statement in var.additional_execution_role_policy_statements',
    );

    // 13.7: IAM inbound authorization through the provider-equivalent
    // absence of custom JWT configuration on both providers.
    expect(cdk.construct).not.toMatch(/authorizerConfiguration:/);
    const activeAuthorizerLines = tf.module
      .split('\n')
      .filter(
        (line) =>
          line.includes('authorizer_configuration') &&
          !line.trimStart().startsWith('#'),
      );
    expect(activeAuthorizerLines).toEqual([]);

    // 5.8: grantInvokeAccess is the construct's only principal grant, and
    // no child-wildcard or concatenated ARN appears anywhere.
    expect(countOccurrences(cdk.construct, 'iam.Grant.addToPrincipal(')).toBe(
      1,
    );
    expect(cdk.construct).not.toContain('attrArn}/');
    expect(cdk.construct).not.toContain('attrArn + ');
  });
});
