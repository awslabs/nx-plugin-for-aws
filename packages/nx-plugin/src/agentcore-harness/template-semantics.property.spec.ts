/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 4: Template rendering preserves resolved defaults across providers
 * Validates: Requirements 3.1, 3.2, 3.3, 6.7, 13.7
 *
 * For all valid model IDs, system prompts, allowed-tool lists, and optional
 * positive execution limits - including quotes, newlines, backslashes,
 * Unicode, and interpolation-like text - the semantic values represented by
 * generated CDK and Terraform resources equal the resolved inputs, omitted
 * limits retain provider-default semantics, both providers represent IAM
 * authorization through provider-equivalent absence of custom JWT
 * configuration, and both providers represent equivalent MVP defaults.
 *
 * Each case runs the full generator TWICE on fresh empty workspaces (once
 * per IaC provider, same remaining options) and DECODES the rendered
 * values back out of both outputs:
 *
 * - CDK: the construct is parsed with the TypeScript compiler API and the
 *   `CfnHarness` prop values are read from the AST. This is deliberately
 *   not a substring match: repository-standard formatting requotes string
 *   literals (e.g. JSON's `"..."` becomes `'...'`), so only a real
 *   TypeScript parse observes the value a TypeScript compiler would see.
 * - Terraform: variable defaults are extracted line-anchored (encoded HCL
 *   strings can never contain a raw newline, so `\nvariable "x" {` cannot
 *   be spoofed by hostile content) and decoded with an independent HCL
 *   quoted-literal decoder implemented from the HCL spec semantics
 *   (`\\`, `\"`, `\n`, `\r`, `\t`, `\uNNNN`/`\UNNNNNNNN`, and the `$${` /
 *   `%%{` template-escape sequences), not by reusing the implementation's
 *   encoder.
 *
 * Runtime note: each case is two complete generator runs including real
 * repository-standard formatting (formatting is kept ON because prettier
 * requoting is exactly the kind of transformation the CDK decoding must
 * survive). 100 runs stay within the suite's 120s per-test budget.
 */
import type { Tree } from '@nx/devkit';
import fc from 'fast-check';
import ts from 'typescript';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { agentcoreHarnessGenerator } from './generator';
import {
  DEFAULT_HARNESS_ALLOWED_TOOLS,
  DEFAULT_HARNESS_MODEL_ID,
  DEFAULT_HARNESS_SYSTEM_PROMPT,
  resolveAgentcoreHarnessOptions,
} from './resolve-options';
import type { AgentcoreHarnessGeneratorSchema } from './schema';

// ---------------------------------------------------------------------------
// Model: the cross-provider semantic contract from the requirements.
//
// - 3.1: the resolved modelId / systemPrompt / allowedTools become the
//   Harness deployment defaults in the Generated Infrastructure.
// - 3.2: a supplied positive execution limit is configured on the Native
//   Harness Resource (as the same number on both providers).
// - 3.3: an omitted execution limit omits the CDK resource property and
//   renders the provider-equivalent `null` Terraform variable default.
// - 6.7: Terraform variable defaults equal the CDK generated defaults for
//   the same Generator invocation.
// - 13.7: both providers represent the same model ID, system prompt,
//   allowed tools, execution limits, and IAM authorization mode
//   (provider-equivalent absence of custom JWT configuration).
//
// The output surfaces are fixed by requirements 5.1 and 6.1 and restated
// literally here rather than imported from implementation constants.
// ---------------------------------------------------------------------------

const cdkConstructPath = (kebab: string): string =>
  `packages/common/constructs/src/app/harnesses/${kebab}/${kebab}.ts`;
const tfModulePath = (kebab: string): string =>
  `packages/common/terraform/src/app/harnesses/${kebab}/${kebab}.tf`;

// ---------------------------------------------------------------------------
// CDK decoding: TypeScript AST extraction of the CfnHarness props.
// ---------------------------------------------------------------------------

/** Semantic values decoded from the rendered CDK construct. */
interface DecodedCdkHarness {
  modelId: string;
  systemPrompt: string;
  allowedTools: string[];
  maxIterations: number | undefined;
  maxTokens: number | undefined;
  timeoutSeconds: number | undefined;
  /** Property names of the CfnHarness props object, in source order. */
  propertyNames: string[];
  /** Index of the `...harnessProps` spread within the props object. */
  spreadIndex: number;
}

const propertyName = (property: ts.ObjectLiteralElementLike): string =>
  property.name !== undefined && ts.isIdentifier(property.name)
    ? property.name.text
    : '';

/** The initializer of a named property assignment, if present. */
const propertyInitializer = (
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | undefined => {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property) === name) {
      return property.initializer;
    }
  }
  return undefined;
};

/** Decode a string-literal initializer to its cooked string value. */
const stringValue = (expression: ts.Expression | undefined): string => {
  if (expression === undefined || !ts.isStringLiteral(expression)) {
    throw new Error('expected a string literal');
  }
  // `.text` is the value after the TypeScript scanner decodes every escape
  // sequence - exactly what the compiled construct would pass to the
  // CfnHarness resource at synth time.
  return expression.text;
};

/** Decode an optional numeric-literal initializer. */
const numberValue = (
  expression: ts.Expression | undefined,
): number | undefined => {
  if (expression === undefined) {
    return undefined;
  }
  if (!ts.isNumericLiteral(expression)) {
    throw new Error('expected a numeric literal');
  }
  return Number(expression.text);
};

/**
 * Parse the rendered construct and decode the `new agentcore.CfnHarness`
 * props object. Throws (failing the property) when the rendered source
 * does not parse cleanly or does not contain the expected structure - a
 * broken escape necessarily surfaces as one of those failures.
 */
const decodeCdkConstruct = (construct: string): DecodedCdkHarness => {
  const sourceFile = ts.createSourceFile(
    'construct.ts',
    construct,
    ts.ScriptTarget.Latest,
    true,
  );
  // A rendering/escaping bug can produce source that still "parses" into
  // an unexpected shape; reject outright syntax errors first.
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] }
  ).parseDiagnostics;
  if (parseDiagnostics !== undefined && parseDiagnostics.length > 0) {
    throw new Error(
      `rendered CDK construct has syntax errors: ${parseDiagnostics
        .slice(0, 3)
        .map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
        )
        .join('; ')}`,
    );
  }

  let props: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isNewExpression(node) &&
      node.expression.getText(sourceFile).endsWith('CfnHarness') &&
      node.arguments !== undefined &&
      node.arguments.length === 3 &&
      ts.isObjectLiteralExpression(node.arguments[2])
    ) {
      if (props !== undefined) {
        throw new Error('multiple CfnHarness resources rendered');
      }
      props = node.arguments[2];
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (props === undefined) {
    throw new Error('no CfnHarness props object found');
  }

  // model: { bedrockModelConfig: { modelId: <string> } }
  const model = propertyInitializer(props, 'model');
  if (model === undefined || !ts.isObjectLiteralExpression(model)) {
    throw new Error('model prop is not an object literal');
  }
  const bedrockModelConfig = propertyInitializer(model, 'bedrockModelConfig');
  if (
    bedrockModelConfig === undefined ||
    !ts.isObjectLiteralExpression(bedrockModelConfig)
  ) {
    throw new Error('bedrockModelConfig is not an object literal');
  }
  const modelId = stringValue(
    propertyInitializer(bedrockModelConfig, 'modelId'),
  );

  // systemPrompt: [{ text: <string> }]
  const systemPromptProp = propertyInitializer(props, 'systemPrompt');
  if (
    systemPromptProp === undefined ||
    !ts.isArrayLiteralExpression(systemPromptProp) ||
    systemPromptProp.elements.length !== 1 ||
    !ts.isObjectLiteralExpression(systemPromptProp.elements[0])
  ) {
    throw new Error('systemPrompt is not a single-element block array');
  }
  const systemPrompt = stringValue(
    propertyInitializer(systemPromptProp.elements[0], 'text'),
  );

  // allowedTools: [<string>, ...]
  const allowedToolsProp = propertyInitializer(props, 'allowedTools');
  if (
    allowedToolsProp === undefined ||
    !ts.isArrayLiteralExpression(allowedToolsProp)
  ) {
    throw new Error('allowedTools is not an array literal');
  }
  const allowedTools = allowedToolsProp.elements.map((element) =>
    stringValue(element),
  );

  const propertyNames = props.properties.map(propertyName);
  const spreadIndex = props.properties.findIndex(
    (property) =>
      ts.isSpreadAssignment(property) &&
      property.expression.getText(sourceFile) === 'harnessProps',
  );

  return {
    modelId,
    systemPrompt,
    allowedTools,
    maxIterations: numberValue(propertyInitializer(props, 'maxIterations')),
    maxTokens: numberValue(propertyInitializer(props, 'maxTokens')),
    timeoutSeconds: numberValue(propertyInitializer(props, 'timeoutSeconds')),
    propertyNames,
    spreadIndex,
  };
};

// ---------------------------------------------------------------------------
// Terraform decoding: an independent HCL quoted-literal decoder.
// ---------------------------------------------------------------------------

/**
 * Decode one HCL quoted string literal (including the surrounding quotes)
 * to its semantic value, implemented from the HCL spec:
 *
 * - escape sequences `\\`, `\"`, `\n`, `\r`, `\t`, `\uNNNN`, `\UNNNNNNNN`
 * - template escapes `$${` for a literal `${` and `%%{` for a literal `%{`
 *
 * An unescaped `${` or `%{` inside a variable default would be an ACTIVE
 * template interpolation/directive - never a literal value - so the
 * decoder rejects it: rendered defaults must be pure literals.
 */
const decodeHclStringLiteral = (literal: string): string => {
  if (
    literal.length < 2 ||
    !literal.startsWith('"') ||
    !literal.endsWith('"')
  ) {
    throw new Error(`not a quoted HCL string literal: ${literal}`);
  }
  const body = literal.slice(1, -1);
  let decoded = '';
  let i = 0;
  while (i < body.length) {
    if (body.startsWith('$${', i)) {
      decoded += '${';
      i += 3;
    } else if (body.startsWith('%%{', i)) {
      decoded += '%{';
      i += 3;
    } else if (body.startsWith('${', i) || body.startsWith('%{', i)) {
      throw new Error(
        `active template sequence in rendered default: ${body.slice(i, i + 8)}`,
      );
    } else if (body[i] === '\\') {
      const escapeChar = body[i + 1];
      switch (escapeChar) {
        case 'n':
          decoded += '\n';
          i += 2;
          break;
        case 'r':
          decoded += '\r';
          i += 2;
          break;
        case 't':
          decoded += '\t';
          i += 2;
          break;
        case '"':
          decoded += '"';
          i += 2;
          break;
        case '\\':
          decoded += '\\';
          i += 2;
          break;
        case 'u':
          decoded += String.fromCharCode(
            Number.parseInt(body.slice(i + 2, i + 6), 16),
          );
          i += 6;
          break;
        case 'U':
          decoded += String.fromCodePoint(
            Number.parseInt(body.slice(i + 2, i + 10), 16),
          );
          i += 10;
          break;
        default:
          throw new Error(`invalid HCL escape sequence: \\${escapeChar}`);
      }
    } else if (body[i] === '"') {
      throw new Error('unescaped quote inside HCL string literal');
    } else {
      decoded += body[i];
      i += 1;
    }
  }
  return decoded;
};

/** Split an HCL list literal `["a", "b"]` into its raw quoted literals. */
const splitHclStringList = (literal: string): string[] => {
  if (!literal.startsWith('[') || !literal.endsWith(']')) {
    throw new Error(`not an HCL list literal: ${literal}`);
  }
  const body = literal.slice(1, -1).trim();
  if (body === '') {
    return [];
  }
  const elements: string[] = [];
  let i = 0;
  while (i < body.length) {
    if (body[i] !== '"') {
      throw new Error(`expected a quoted literal at: ${body.slice(i, i + 8)}`);
    }
    const start = i;
    i += 1;
    while (i < body.length) {
      if (body[i] === '\\') {
        i += 2; // an escape never ends the literal
      } else if (body[i] === '"') {
        i += 1;
        break;
      } else {
        i += 1;
      }
    }
    elements.push(body.slice(start, i));
    // Skip the `, ` separator (or trailing whitespace) between elements.
    while (i < body.length && (body[i] === ',' || body[i] === ' ')) {
      i += 1;
    }
  }
  return elements;
};

/**
 * Extract the raw `default = ...` expression of one Terraform variable.
 *
 * Anchored on `\nvariable "<name>" {`: encoded HCL string values can never
 * contain a raw newline (newlines are escaped to `\n`), so hostile
 * generated content cannot spoof a line-leading block header, and the
 * single `default` attribute line inside the block always carries the
 * entire (single-line) encoded value.
 */
const tfVariableDefaultRaw = (module: string, name: string): string => {
  const header = `\nvariable "${name}" {`;
  const start = module.indexOf(header);
  expect(start, `variable "${name}" not found`).toBeGreaterThanOrEqual(0);
  const nextBlock = module.indexOf('\nvariable "', start + header.length);
  const section = module.slice(start, nextBlock === -1 ? undefined : nextBlock);
  const match = section.match(/\n\s*default\s*=\s*(.+)/);
  expect(match, `default of variable "${name}" not found`).not.toBeNull();
  return match![1].trim();
};

/** Semantic values decoded from the rendered Terraform module. */
interface DecodedTfHarness {
  modelId: string;
  systemPrompt: string;
  allowedTools: string[];
  maxIterations: number | undefined;
  maxTokens: number | undefined;
  timeoutSeconds: number | undefined;
  /** The `resource "aws_bedrockagentcore_harness" "this"` slice. */
  resourceSlice: string;
}

/** Decode a limit default: `null` means provider-default semantics. */
const tfLimitValue = (module: string, name: string): number | undefined => {
  const raw = tfVariableDefaultRaw(module, name);
  if (raw === 'null') {
    return undefined;
  }
  const value = Number(raw);
  expect(
    Number.isFinite(value),
    `default of "${name}" is neither null nor a number: ${raw}`,
  ).toBe(true);
  return value;
};

const decodeTfModule = (module: string): DecodedTfHarness => {
  // Everything after the (newline-anchored, unspoofable) resource header
  // contains no user-controlled strings, so plain slicing is safe.
  const resourceHeader = '\nresource "aws_bedrockagentcore_harness" "this" {';
  const resourceStart = module.indexOf(resourceHeader);
  expect(
    resourceStart,
    'native harness resource not found',
  ).toBeGreaterThanOrEqual(0);

  return {
    modelId: decodeHclStringLiteral(tfVariableDefaultRaw(module, 'model_id')),
    systemPrompt: decodeHclStringLiteral(
      tfVariableDefaultRaw(module, 'system_prompt'),
    ),
    allowedTools: splitHclStringList(
      tfVariableDefaultRaw(module, 'allowed_tools'),
    ).map(decodeHclStringLiteral),
    maxIterations: tfLimitValue(module, 'max_iterations'),
    maxTokens: tfLimitValue(module, 'max_tokens'),
    timeoutSeconds: tfLimitValue(module, 'timeout_seconds'),
    resourceSlice: module.slice(resourceStart),
  };
};

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const containsNonWhitespace = (value: string): boolean => /\S/.test(value);

/**
 * Valid names kept deliberately simple: name normalization is Property 2
 * and deployed-name construction is Property 6. Distinct seeds still vary
 * the rendered class names and paths across cases.
 */
const arbName = fc
  .tuple(
    fc.constantFrom('harness', 'My Harness', 'p4', 'semantics'),
    fc.string({
      unit: fc.constantFrom('a', 'z', '0', '9', '-'),
      maxLength: 6,
    }),
  )
  .map(([seed, decoration]) => seed + decoration);

/**
 * Hostile string fragments weighted toward the escaping edge cases named
 * by the property: quotes, backslashes, newlines, tabs, carriage returns,
 * template interpolation (`${`) and directive (`%{`) introducers plus
 * their already-escaped forms, single quotes/backticks (prettier requoting
 * pressure), Unicode (including astral pairs), and control characters.
 */
const arbHostileFragment = fc.constantFrom(
  '"',
  '\\',
  '\\\\',
  '\\"',
  '\n',
  '\r',
  '\r\n',
  '\t',
  '${',
  '%{',
  '$${',
  '%%{',
  '${var.hijack}',
  '%{ if true }',
  '${jsonencode("x")}',
  "'",
  '`',
  '`${x}`',
  '</script>',
  '<%- ejs %>',
  'café',
  '✓',
  '🎉',
  '\u2028',
  '\u2029',
  '\u0000',
  '\u0007',
  '\u001b',
  '$',
  '$$',
  '%',
  '%%',
  '{',
  '}',
);

const arbPlainChunk = fc.string({ maxLength: 8 });

/**
 * Free-text values built by interleaving hostile fragments with ordinary
 * text, constrained to the schema predicate (at least one non-whitespace
 * character). Fragment-heavy composition keeps every case interesting
 * while the plain chunks vary the surrounding context of each hazard.
 */
const arbHostileText = fc
  .array(fc.oneof(arbHostileFragment, arbHostileFragment, arbPlainChunk), {
    minLength: 1,
    maxLength: 8,
  })
  .map((parts) => parts.join(''))
  .filter(containsNonWhitespace);

/** Allowed-tool arrays: 1-8 entries of hostile content. */
const arbAllowedTools = fc.array(
  fc.oneof(fc.constant('@builtin'), arbHostileText),
  { minLength: 1, maxLength: 8 },
);

const arbLimit = fc.option(fc.integer({ min: 1, max: 2_000_000 }), {
  nil: undefined,
});

interface SemanticsCandidate {
  name: string;
  modelId: string | undefined;
  systemPrompt: string | undefined;
  allowedTools: string[] | undefined;
  maxIterations: number | undefined;
  maxTokens: number | undefined;
  timeoutSeconds: number | undefined;
}

/**
 * Every free-text option is independently supplied (hostile) or omitted
 * (exact MVP default), so cross-provider equality is observed for
 * generated defaults and hostile custom values in the same run set.
 */
const arbSemanticsCandidate: fc.Arbitrary<SemanticsCandidate> = fc.record({
  name: arbName,
  modelId: fc.option(arbHostileText, { nil: undefined }),
  systemPrompt: fc.option(arbHostileText, { nil: undefined }),
  allowedTools: fc.option(arbAllowedTools, { nil: undefined }),
  maxIterations: arbLimit,
  maxTokens: arbLimit,
  timeoutSeconds: arbLimit,
});

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('agentcore-harness cross-provider template semantics (Property 4)', () => {
  // Feature: agentcore-harness-generator, Property 4: Template rendering preserves resolved defaults across providers
  // **Validates: Requirements 3.1, 3.2, 3.3, 6.7, 13.7**
  it('renders equal decoded defaults, omitted-limit semantics, precedence, and IAM authorization on both providers', async () => {
    await fc.assert(
      fc.asyncProperty(arbSemanticsCandidate, async (candidate) => {
        const common: Omit<AgentcoreHarnessGeneratorSchema, 'iac'> = {
          name: candidate.name,
          modelId: candidate.modelId,
          systemPrompt: candidate.systemPrompt,
          allowedTools: candidate.allowedTools,
          maxIterations: candidate.maxIterations,
          maxTokens: candidate.maxTokens,
          timeoutSeconds: candidate.timeoutSeconds,
        };

        // The resolved inputs this Generator invocation must preserve
        // (schema-resolution itself is Property 1/2 territory; here the
        // exact documented defaults are restated as the expectation).
        const expected = {
          modelId: candidate.modelId ?? DEFAULT_HARNESS_MODEL_ID,
          systemPrompt: candidate.systemPrompt ?? DEFAULT_HARNESS_SYSTEM_PROMPT,
          allowedTools: candidate.allowedTools ?? [
            ...DEFAULT_HARNESS_ALLOWED_TOOLS,
          ],
        };

        // One full generator run per provider, same remaining options,
        // each on a fresh empty workspace.
        const cdkTree: Tree = createTreeUsingTsSolutionSetup();
        const kebab = resolveAgentcoreHarnessOptions(cdkTree, {
          ...common,
          iac: 'cdk',
        }).nameKebabCase;
        await agentcoreHarnessGenerator(cdkTree, { ...common, iac: 'cdk' });
        const terraformTree: Tree = createTreeUsingTsSolutionSetup();
        await agentcoreHarnessGenerator(terraformTree, {
          ...common,
          iac: 'terraform',
        });

        // Both providers rendered their Harness output for the same name.
        const construct = cdkTree.read(cdkConstructPath(kebab), 'utf-8');
        expect(construct).not.toBeNull();
        const module = terraformTree.read(tfModulePath(kebab), 'utf-8');
        expect(module).not.toBeNull();

        const cdk = decodeCdkConstruct(construct!);
        const tf = decodeTfModule(module!);

        // 3.1 / 6.7 / 13.7: decoded CDK value === decoded Terraform value
        // === resolved input, exact string equality including hostile
        // characters; allowed tools additionally preserve order and count.
        expect(cdk.modelId).toBe(expected.modelId);
        expect(tf.modelId).toBe(expected.modelId);
        expect(cdk.systemPrompt).toBe(expected.systemPrompt);
        expect(tf.systemPrompt).toBe(expected.systemPrompt);
        expect(cdk.allowedTools).toEqual(expected.allowedTools);
        expect(tf.allowedTools).toEqual(expected.allowedTools);

        // 3.2 / 3.3: a supplied limit is the same literal number on both
        // providers; an omitted limit is an ABSENT CDK property and a
        // `null` Terraform default. Each limit is independent.
        expect(cdk.maxIterations).toBe(candidate.maxIterations);
        expect(tf.maxIterations).toBe(candidate.maxIterations);
        expect(cdk.maxTokens).toBe(candidate.maxTokens);
        expect(tf.maxTokens).toBe(candidate.maxTokens);
        expect(cdk.timeoutSeconds).toBe(candidate.timeoutSeconds);
        expect(tf.timeoutSeconds).toBe(candidate.timeoutSeconds);
        for (const [limit, supplied] of [
          ['maxIterations', candidate.maxIterations],
          ['maxTokens', candidate.maxTokens],
          ['timeoutSeconds', candidate.timeoutSeconds],
        ] as const) {
          expect(cdk.propertyNames.includes(limit)).toBe(
            supplied !== undefined,
          );
        }

        // 6.7 / 13.7: IAM authorization on both providers through the
        // provider-equivalent absence of custom JWT configuration. The
        // CDK check is an AST property check (immune to hostile prompt
        // content); the Terraform check inspects only the resource slice,
        // which contains no user-controlled strings.
        expect(cdk.propertyNames).not.toContain('authorizerConfiguration');
        const activeAuthorizerLines = tf.resourceSlice
          .split('\n')
          .filter(
            (line) =>
              line.includes('authorizer_configuration') &&
              !line.trimStart().startsWith('#'),
          );
        expect(activeAuthorizerLines).toEqual([]);

        // 3.6-structure supporting 3.1/3.2: generated defaults come before
        // the caller `...harnessProps` spread in CDK, so explicit caller
        // configuration takes precedence.
        expect(cdk.spreadIndex).toBeGreaterThanOrEqual(0);
        for (const name of [
          'model',
          'systemPrompt',
          'allowedTools',
          ...(candidate.maxIterations !== undefined ? ['maxIterations'] : []),
          ...(candidate.maxTokens !== undefined ? ['maxTokens'] : []),
          ...(candidate.timeoutSeconds !== undefined ? ['timeoutSeconds'] : []),
        ]) {
          const index = cdk.propertyNames.indexOf(name);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(cdk.spreadIndex);
        }

        // Terraform precedence structure: every MVP resource attribute
        // references its variable (`var.*`), so caller module arguments
        // override the rendered variable defaults.
        expect(tf.resourceSlice).toMatch(
          /model\s*\{\s*bedrock_model_config\s*\{\s*model_id\s*=\s*var\.model_id/,
        );
        expect(tf.resourceSlice).toMatch(
          /system_prompt\s*\{\s*text\s*=\s*var\.system_prompt/,
        );
        expect(tf.resourceSlice).toMatch(
          /allowed_tools\s*=\s*var\.allowed_tools/,
        );
        expect(tf.resourceSlice).toMatch(
          /max_iterations\s*=\s*var\.max_iterations/,
        );
        expect(tf.resourceSlice).toMatch(/max_tokens\s*=\s*var\.max_tokens/);
        expect(tf.resourceSlice).toMatch(
          /timeout_seconds\s*=\s*var\.timeout_seconds/,
        );
      }),
      // At least 100 runs required; each run is two complete generator
      // runs (one per provider) with real formatting.
      { numRuns: 100 },
    );
    // Two full generator runs per case put this a few seconds under the
    // default 120s budget in isolation, so it times out once the suite runs
    // in parallel. Use the same allowance as the other whole-workspace
    // property tests.
  }, 300_000);
});
