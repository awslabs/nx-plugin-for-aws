/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 18: Terraform IAM extension serialization preserves statements
 * Validates: Requirements 6.8, 7.7
 *
 * For all valid additional policy statements with arbitrary action/resource
 * collections and optional statement identifiers or conditions, Terraform
 * policy construction preserves each statement's effect, actions, resources,
 * identifier, and condition without adding permissions to other statements.
 *
 * The rendered module declares
 * `variable "additional_execution_role_policy_statements"` as
 * `list(object({ Sid = optional(string), Effect = string, Action =
 * list(string), Resource = list(string), Condition = optional(any) }))` and
 * appends it to the reviewed baseline through
 * `Statement = concat([...11 baseline...], [for statement in
 * var.additional_execution_role_policy_statements : { for key, value in
 * statement : key => value if value != null }])`. Terraform's `optional()`
 * gives every unsupplied attribute the value `null`, and the object
 * comprehension drops exactly those `null` entries from the rendered policy
 * JSON.
 *
 * The IAM serialization logic is static per generated Harness, so the module
 * is rendered ONCE (one full generator run) and the `policy = jsonencode(...)`
 * argument is extracted and compiled into a directly evaluable function - the
 * same approach as the Property 8 harness in iam-boundary.property.spec.ts,
 * except the extension arm is kept LIVE instead of inlined as `[]`: after the
 * exact comprehension text is verified, the HCL for-expression is replaced by
 * an injected `stripNullEntries(additionalStatements)` mirror implementing
 * the same semantics (for each statement object, keep exactly the entries
 * whose value is not `null`). Generated statements are always passed as
 * VALUES into the compiled function, never concatenated into source text, so
 * each of the 100+ runs evaluates the real rendered baseline-plus-extension
 * expression at sub-millisecond cost.
 *
 * `terraform validate` coverage for a fixture carrying extension statements
 * is owned by terraform-validate.spec.ts (Task 4.4); this property
 * intentionally does not shell out to the Terraform CLI.
 */
import fc from 'fast-check';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { agentcoreHarnessGenerator } from './generator';
import { resolveAgentcoreHarnessOptions } from './resolve-options';

// ---------------------------------------------------------------------------
// Sentinels for the module's deployment-scope interpolations. None of them
// may contain '"', '\\', or '${' (they are substituted into extracted source
// text). Generated statement values never need such restrictions because
// they enter the compiled expression as function arguments.
// ---------------------------------------------------------------------------

const PARTITION = '<partition>';
const REGION = '<region>';
const ACCOUNT = '<account-id>';
const DEPLOYED_NAME = '<deployed-harness-name>';

/**
 * Fixed model-resource allowlist for the baseline arm. Property 8 already
 * drives this configuration point across arbitrary allowlists; Property 18
 * holds it constant and varies only the extension statements.
 */
const FIXED_MODEL_RESOURCES: readonly string[] = [
  `arn:${PARTITION}:bedrock:*::foundation-model/*`,
  `arn:${PARTITION}:bedrock:${REGION}:${ACCOUNT}:*`,
];

/** The baseline concat arm renders exactly these reviewed statements. */
const BASELINE_STATEMENT_COUNT = 12;

// ---------------------------------------------------------------------------
// Exact rendered extension texts. These anchor both the compilation (the
// live arm must be the verified comprehension before it is mirrored) and the
// template-tie assertions below.
// ---------------------------------------------------------------------------

const EXTENSION_VARIABLE_DECLARATION =
  'variable "additional_execution_role_policy_statements"';

/** Requirement 6.8: optional Sid/Condition in the structured variable type. */
const EXTENSION_VARIABLE_TYPE = `  type = list(object({
    Sid       = optional(string)
    Effect    = string
    Action    = list(string)
    Resource  = list(string)
    Condition = optional(any)
  }))`;

const EXTENSION_FOR_STATEMENT =
  'for statement in var.additional_execution_role_policy_statements :';

const EXTENSION_NULL_STRIP =
  '{ for key, value in statement : key => value if value != null }';

/**
 * JS mirror of the rendered HCL extension arm
 * `[for statement in var... : { for key, value in statement : key => value
 * if value != null }]`: for each statement object, keep exactly the entries
 * whose value is not `null` (Terraform `optional()` models an unsupplied
 * attribute as `null`, so this is precisely the optional-field omission).
 */
const stripNullEntries = (
  statements: ReadonlyArray<Record<string, unknown>>,
): Array<Record<string, unknown>> =>
  statements.map((statement) =>
    Object.fromEntries(
      Object.entries(statement).filter(([, value]) => value !== null),
    ),
  );

// ---------------------------------------------------------------------------
// Extraction helpers, adapted from iam-boundary.property.spec.ts. They are
// copied rather than shared so the Property 8 harness (which inlines the
// extension arm as its rendered-default `[]`) stays untouched.
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
): number => {
  const index = text.indexOf(needle);
  if (index < 0) {
    throw new Error(`${description} not found in rendered output`);
  }
  return index;
};

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

interface CompiledExtensionPolicy {
  module: string;
  /**
   * The real `policy = jsonencode({...})` document with the extension arm
   * live: `additionalStatements` is injected exactly where the rendered
   * expression reads `var.additional_execution_role_policy_statements`.
   */
  policyDocument: (
    modelResourceArns: readonly string[],
    additionalStatements: ReadonlyArray<Record<string, unknown>>,
  ) => TfPolicyDocument;
}

const compileExtensionPolicy = (module: string): CompiledExtensionPolicy => {
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

  // Verify the live extension arm is the expected null-stripping
  // comprehension over the extension variable, then replace the HCL
  // for-expression (JS cannot parse it) with the semantically equivalent
  // injected mirror over an injectable parameter.
  const armPattern = /\], \[[\s\S]*?\]\)/;
  const armMatch = policyArg.match(armPattern);
  if (armMatch === null) {
    throw new Error('additional-statements concat arm not found in the policy');
  }
  for (const requiredText of [EXTENSION_FOR_STATEMENT, EXTENSION_NULL_STRIP]) {
    if (!armMatch[0].includes(requiredText)) {
      throw new Error(`extension arm is missing \`${requiredText}\``);
    }
  }
  const substituted = policyArg.replace(
    armPattern,
    '], stripNullEntries(additionalStatements))',
  );

  const policyFn = new Function(
    'local',
    'concat',
    'stripNullEntries',
    'additionalStatements',
    `return (${hclObjectToJs(substituteTfRefs(substituted))});`,
  ) as (
    local: { account_id: string; model_resource_arns: readonly string[] },
    concat: (a: unknown[], b: unknown[]) => unknown[],
    stripNullEntriesFn: typeof stripNullEntries,
    additionalStatements: ReadonlyArray<Record<string, unknown>>,
  ) => TfPolicyDocument;
  const concat = (a: unknown[], b: unknown[]): unknown[] => [...a, ...b];

  return {
    module,
    policyDocument: (modelResourceArns, additionalStatements) =>
      policyFn(
        { account_id: ACCOUNT, model_resource_arns: [...modelResourceArns] },
        concat,
        stripNullEntries,
        additionalStatements,
      ),
  };
};

// ---------------------------------------------------------------------------
// Arbitraries: structured extension statements exactly as Terraform's type
// constraint delivers them to the comprehension - every declared attribute
// exists, and unsupplied `optional()` attributes are `null`.
// ---------------------------------------------------------------------------

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';

const charsOf = (alphabet: string): fc.Arbitrary<string> =>
  fc.constantFrom(...alphabet.split(''));

/**
 * Alphanumeric statement IDs. The rare empty string pins down that the
 * comprehension strips only `null`, never other falsy values.
 */
const arbSid = fc.oneof(
  {
    weight: 9,
    arbitrary: fc
      .tuple(
        charsOf(UPPER),
        fc.string({ unit: charsOf(UPPER + LOWER + DIGITS), maxLength: 19 }),
      )
      .map(([first, rest]) => `${first}${rest}`),
  },
  { weight: 1, arbitrary: fc.constant('') },
);

/** Realistic `service:Operation` action shapes, including verb wildcards. */
const arbActionService = fc.constantFrom(
  's3',
  'dynamodb',
  'sqs',
  'kms',
  'lambda',
  'secretsmanager',
  'states',
  'bedrock-agentcore',
);
const arbActionVerb = fc.constantFrom(
  'Get',
  'Put',
  'List',
  'Describe',
  'Create',
  'Delete',
  'Invoke',
  'Start',
  'Stop',
  'Update',
);
const arbActionNoun = fc.constantFrom(
  'Object',
  'Item',
  'Queue',
  'Key',
  'Function',
  'SecretValue',
  'Gateway',
  'Memory',
  'Session',
  'Execution',
  'Table',
);
const arbIamAction = fc.oneof(
  fc
    .tuple(arbActionService, arbActionVerb, arbActionNoun)
    .map(([service, verb, noun]) => `${service}:${verb}${noun}`),
  fc
    .tuple(arbActionService, arbActionVerb)
    .map(([service, verb]) => `${service}:${verb}*`),
);

/** ARN-ish resource shapes across partitions, plus the bare wildcard. */
const arbPartitionSegment = fc.constantFrom('aws', 'aws-cn', 'aws-us-gov');
const arbRegionSegment = fc.constantFrom(
  'us-east-1',
  'us-west-2',
  'eu-central-1',
  'ap-southeast-2',
  'cn-north-1',
  'us-gov-west-1',
);
const arbAccountSegment = fc.string({
  unit: charsOf(DIGITS),
  minLength: 12,
  maxLength: 12,
});
const arbResourceIdSegment = fc.string({
  unit: charsOf(`${LOWER}${DIGITS}._-`),
  minLength: 1,
  maxLength: 20,
});
const arbResourceArn = fc.oneof(
  fc
    .tuple(
      arbPartitionSegment,
      arbActionService,
      arbRegionSegment,
      arbAccountSegment,
      arbResourceIdSegment,
    )
    .map(([p, service, r, a, id]) => `arn:${p}:${service}:${r}:${a}:${id}`),
  fc
    .tuple(
      arbPartitionSegment,
      arbActionService,
      arbRegionSegment,
      arbAccountSegment,
      arbResourceIdSegment,
    )
    .map(([p, service, r, a, id]) => `arn:${p}:${service}:${r}:${a}:${id}/*`),
  // Global-style ARN without region/account segments (e.g. S3 buckets).
  fc
    .tuple(arbPartitionSegment, arbResourceIdSegment)
    .map(([p, id]) => `arn:${p}:s3:::${id}`),
  fc.constant('*'),
);

/**
 * Nested operator -> key -> value condition objects; values are single
 * strings or string lists as in real IAM condition blocks.
 */
const arbConditionOperator = fc.constantFrom(
  'StringEquals',
  'StringLike',
  'ArnLike',
  'Bool',
  'NumericLessThanEquals',
  'IpAddress',
);
const arbConditionKey = fc.constantFrom(
  'aws:SourceAccount',
  'aws:SourceArn',
  'aws:PrincipalOrgID',
  'aws:RequestedRegion',
  's3:prefix',
  'kms:ViaService',
  'aws:SecureTransport',
);
const arbConditionValue = fc.oneof(
  fc.string({
    unit: charsOf(`${LOWER}${DIGITS}:/.*-`),
    minLength: 1,
    maxLength: 24,
  }),
  fc.constantFrom('true', 'false'),
);
const arbCondition = fc.dictionary(
  arbConditionOperator,
  fc.dictionary(
    arbConditionKey,
    fc.oneof(
      arbConditionValue,
      fc.array(arbConditionValue, { minLength: 1, maxLength: 3 }),
    ),
    { minKeys: 1, maxKeys: 3 },
  ),
  { minKeys: 1, maxKeys: 3 },
);

type GeneratedExtensionStatement = {
  Sid: string | null;
  Effect: 'Allow' | 'Deny';
  Action: string[];
  Resource: string[];
  Condition: Record<string, Record<string, string | string[]>> | null;
};

const arbExtensionStatement: fc.Arbitrary<GeneratedExtensionStatement> =
  fc.record({
    Sid: fc.option(arbSid, { nil: null }),
    Effect: fc.constantFrom('Allow', 'Deny'),
    Action: fc.array(arbIamAction, { minLength: 1, maxLength: 5 }),
    Resource: fc.array(arbResourceArn, { minLength: 1, maxLength: 4 }),
    Condition: fc.option(arbCondition, { nil: null }),
  });

const arbExtensionStatements = fc.array(arbExtensionStatement, {
  minLength: 0,
  maxLength: 6,
});

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

describe('agentcore-harness Terraform IAM extension serialization (Property 18)', () => {
  let compiled: CompiledExtensionPolicy;
  /** The empty-extension rendering: the pristine 11-statement baseline. */
  let emptyExtensionStatementsJson: string;

  beforeAll(async () => {
    // The policy expression is static per generated Harness, so one full
    // generator run renders everything the property evaluates; the 100+
    // runs then vary only the injected extension statements.
    const tree = createTreeUsingTsSolutionSetup();
    const kebab = resolveAgentcoreHarnessOptions(tree, {
      name: 'iam-extension',
    }).nameKebabCase;
    await agentcoreHarnessGenerator(tree, {
      name: 'iam-extension',
      iac: 'terraform',
    });
    const module = tree.read(
      `packages/common/terraform/src/app/harnesses/${kebab}/${kebab}.tf`,
      'utf-8',
    );
    expect(module).not.toBeNull();
    compiled = compileExtensionPolicy(module as string);

    const emptyRendering = compiled.policyDocument(FIXED_MODEL_RESOURCES, []);
    expect(emptyRendering.Statement).toHaveLength(BASELINE_STATEMENT_COUNT);
    emptyExtensionStatementsJson = JSON.stringify(emptyRendering.Statement);
  });

  // Feature: agentcore-harness-generator, Property 18: Terraform IAM extension serialization preserves statements
  // **Validates: Requirements 6.8, 7.7**
  it('preserves every extension statement losslessly after the unchanged 11-statement baseline', () => {
    fc.assert(
      fc.property(arbExtensionStatements, (statements) => {
        // The compiled expression receives deep clones so pass-through
        // references cannot mask input mutation and `statements` stays a
        // pristine comparison target.
        const rendered = compiled.policyDocument(
          FIXED_MODEL_RESOURCES,
          structuredClone(statements),
        );

        // Rendering is a pure function of its inputs.
        const renderedAgain = compiled.policyDocument(
          FIXED_MODEL_RESOURCES,
          structuredClone(statements),
        );
        expect(JSON.stringify(renderedAgain)).toBe(JSON.stringify(rendered));

        // Document shape and the exact 11 + N statement count.
        expect(Object.keys(rendered).sort()).toEqual(['Statement', 'Version']);
        expect(rendered.Version).toBe('2012-10-17');
        expect(rendered.Statement).toHaveLength(
          BASELINE_STATEMENT_COUNT + statements.length,
        );

        // No permission bleed: the baseline statements are byte-identical
        // to the empty-extension rendering, so extension statements never
        // modify or merge into a baseline statement.
        expect(
          JSON.stringify(rendered.Statement.slice(0, BASELINE_STATEMENT_COUNT)),
        ).toBe(emptyExtensionStatementsJson);

        // Losslessness: each generated statement appears in order with its
        // non-null fields deep-equal and its null fields ABSENT (a `null`
        // key would fail both the deep equality and the key-set check).
        statements.forEach((generated, index) => {
          const renderedStatement =
            rendered.Statement[BASELINE_STATEMENT_COUNT + index];
          const expected: Record<string, unknown> = {
            ...(generated.Sid === null ? {} : { Sid: generated.Sid }),
            Effect: generated.Effect,
            Action: generated.Action,
            Resource: generated.Resource,
            ...(generated.Condition === null
              ? {}
              : { Condition: generated.Condition }),
          };
          expect(renderedStatement).toEqual(expected);
          expect(Object.keys(renderedStatement).sort()).toEqual(
            Object.keys(expected).sort(),
          );
          if (generated.Sid === null) {
            expect('Sid' in renderedStatement).toBe(false);
          }
          if (generated.Condition === null) {
            expect('Condition' in renderedStatement).toBe(false);
          }
        });
      }),
      // At least 100 runs required; evaluating the pre-rendered expression
      // keeps each run sub-millisecond.
      { numRuns: 200 },
    );
  });

  // Feature: agentcore-harness-generator, Property 18: Terraform IAM extension serialization preserves statements
  // **Validates: Requirements 6.8, 7.7**
  it('renders the exact structured extension variable type and null-stripping comprehension', () => {
    // 6.8: the structured variable with optional Sid and optional Condition.
    expect(compiled.module).toContain(EXTENSION_VARIABLE_DECLARATION);
    expect(compiled.module).toContain(EXTENSION_VARIABLE_TYPE);

    // 7.7: the extension arm the compiled property evaluates is the
    // rendered concat of the baseline with the null-stripping
    // comprehension over the extension variable.
    expect(compiled.module).toContain('Statement = concat([');
    expect(compiled.module).toContain(EXTENSION_FOR_STATEMENT);
    expect(compiled.module).toContain(EXTENSION_NULL_STRIP);
  });
});
