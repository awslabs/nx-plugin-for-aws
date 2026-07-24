/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 19: Generated output contains no credential material
 * Validates: Requirements 7.8, 7.9
 *
 * For all valid Generator option values and all independent sentinel AWS
 * credential values present only in process environment, SDK providers, or
 * workspace configuration, generated project files, infrastructure files,
 * metadata, and dependency declarations contain none of the sentinel
 * values, and generated SDK client configuration contains no explicit
 * credentials property. Opaque caller option text is preserved and is not
 * classified as a generator-introduced credential leak.
 *
 * Injection channels exercised per run (scope):
 * - Process environment: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and
 *   `AWS_SESSION_TOKEN` are set to run-unique sentinel values before the
 *   generator runs and restored afterwards. This is the main channel — it
 *   is exactly what the standard AWS SDK credential provider chain would
 *   read first, so a generator that consulted ambient credentials would
 *   observe these values.
 * - Workspace configuration: an AWS-CLI-style config file containing the
 *   same sentinels is planted in the workspace tree at a path that is not
 *   a Generator input. It must remain byte-identical and must never be
 *   copied into generated output. (A real `~/.aws` home-directory file is
 *   outside the Nx tree and outside this test's scope.)
 * - SDK providers: the Generator performs no AWS SDK calls while running
 *   (requirement 4.7 restricts side effects to the tree/format/install
 *   hooks), so no SDK credential provider can execute during generation.
 *   This channel is therefore covered statically: the generated Invocation
 *   Client's SDK client configuration is asserted to be exactly
 *   `{ region }` — no explicit `credentials` property — so credential
 *   resolution is deferred to the standard provider chain at invocation
 *   time (7.8) rather than baked into generated source (7.9).
 *
 * Sentinels are unique per run (a monotonic run counter plus a
 * fuzz-supplied random suffix) and share fixed distinctive markers. The
 * leak scan searches every generated path and content for the markers, so
 * a leak of ANY run's sentinel — including cross-run contamination through
 * shared caches — is caught, and the unique tail identifies the source
 * run.
 *
 * Independence of sentinels from opaque options: Property 19 explicitly
 * does not classify caller-supplied option text as a leak, so option
 * arbitraries filter out the sentinel markers and the credential token
 * names. This keeps the injected material provably generator-independent:
 * any sentinel or explicit SDK credential token found in output must have
 * been introduced by the Generator itself.
 *
 * Runtime note: each case is one complete generator run (template
 * rendering plus repository-standard formatting), ~60ms locally, so 120
 * runs stay well within the suite's per-test budget.
 */
import { readJson, type Tree } from '@nx/devkit';
import fc from 'fast-check';
import type { IacOption } from '../utils/iac';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { agentcoreHarnessGenerator } from './generator';
import { resolveAgentcoreHarnessOptions } from './resolve-options';
import type { AgentcoreHarnessGeneratorSchema } from './schema';

// ---------------------------------------------------------------------------
// Model: the credential boundary from the requirements, restated
// independently of the generator implementation.
//
// - 7.8: the Invocation Client uses the standard AWS SDK credential
//   provider chain — modeled as "the generated SDK client constructor
//   receives exactly `{ region }` and no `credentials` property".
// - 7.9: AWS credential values obtained from process environment, SDK
//   providers, or workspace configuration stay OUT of generated source,
//   metadata, and configuration files — modeled as "no sentinel value
//   injected through those channels appears in any generated path or
//   content".
// ---------------------------------------------------------------------------

/**
 * Fixed distinctive markers embedded in every run's sentinel values. Any
 * appearance of a marker in generated output is a leak of some run's
 * sentinel, so scanning for the markers catches both same-run and
 * cross-run contamination. (`AKIA_SENTINEL` is deliberately not a real
 * AKIA-shaped key: the underscore keeps it inert for credential scanners
 * while remaining recognizably access-key-like.)
 */
const SENTINEL_MARKERS = [
  'AKIA_SENTINEL_',
  'SENTINEL_SECRET_ACCESS_KEY_',
  'SENTINEL_SESSION_TOKEN_',
] as const;

/**
 * The AWS SDK's explicit static-credential property names. Generated
 * output must never contain them: the generated client defers entirely to
 * the default provider chain (7.8), and no template legitimately mentions
 * them.
 */
const CREDENTIAL_PROPERTY_TOKENS = [
  'accessKeyId',
  'secretAccessKey',
  'sessionToken',
] as const;

/** Environment variables carrying the sentinel credentials for a run. */
const CREDENTIAL_ENV_KEYS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
] as const;

/**
 * Workspace path of the planted AWS-CLI-style config fixture. Not a
 * Generator input or output surface: it exists only so the "workspace
 * configuration" channel demonstrably holds credential material during the
 * run. It has no formattable extension, so the repository formatter leaves
 * it untouched and byte-identity is a meaningful assertion.
 */
const PLANTED_WORKSPACE_CONFIG_PATH = '.aws-workspace-config/config';

/** Substrings that must not appear in opaque option text (independence). */
const OPTION_TEXT_EXCLUSIONS = [
  'sentinel',
  'credential',
  'accesskeyid',
  'secretaccesskey',
  'sessiontoken',
];

/**
 * Opaque option text must be independent of the injected sentinels and of
 * the scanned credential tokens, since Property 19 explicitly treats
 * caller option text as preserved-but-not-a-leak. Random generation of
 * these substrings is practically impossible; the filter documents and
 * enforces the independence precondition.
 */
const isIndependentOptionText = (value: string): boolean => {
  const lower = value.toLowerCase();
  return OPTION_TEXT_EXCLUSIONS.every((token) => !lower.includes(token));
};

const containsNonWhitespace = (value: string): boolean => /\S/.test(value);

// ---------------------------------------------------------------------------
// Arbitraries (option shapes reused from the routing property, filtered
// for sentinel independence)
// ---------------------------------------------------------------------------

/** The three infrastructure routes (CDK, Terraform, and `infra: none`). */
type Route = 'cdk' | 'terraform' | 'none';

/**
 * Valid human-readable names. Seeds cover the interesting normalization
 * shapes (spaces, camelCase humps, digit-leading words, accents, embedded
 * punctuation) and guarantee the name normalizes to a non-empty
 * identifier; decoration varies the rest.
 */
const arbValidName = fc
  .tuple(
    fc.constantFrom(
      'harness',
      'My Harness',
      'myHarness2',
      '3d',
      'café',
      'a_b.c',
      'Z',
      'x9/y',
    ),
    fc.string({ maxLength: 12 }),
  )
  .map(([seed, decoration]) => seed + decoration)
  .filter(isIndependentOptionText);

/**
 * Custom model IDs and system prompts: free text with at least one
 * non-whitespace character, including quote/backslash/newline/Unicode
 * shapes, so the no-leak scan runs against escaping-sensitive rendered
 * content and not just the defaults.
 */
const arbCustomFreeText = fc
  .oneof(
    fc.string({ minLength: 1, maxLength: 40 }).filter(containsNonWhitespace),
    fc.constantFrom(
      'custom.model-id',
      'anthropic.claude-sonnet-4-5-20250929-v1:0',
      'Custom prompt with "quotes", \\backslashes\\ and\nnewlines.',
      'unicode tëxt ✓',
    ),
  )
  .filter(isIndependentOptionText);

const arbToolEntry = fc
  .oneof(
    fc.constant('@builtin'),
    fc.string({ minLength: 1, maxLength: 16 }).filter(containsNonWhitespace),
  )
  .filter(isIndependentOptionText);

/** Valid custom allowed-tool arrays (1 through 8 entries). */
const arbCustomAllowedTools = fc.array(arbToolEntry, {
  minLength: 1,
  maxLength: 8,
});

const arbCustomLimit = fc.integer({ min: 1, max: 2_000_000 });

interface CredentialFreeCandidate {
  route: Route;
  name: string;
  /** Whether `infra: 'agentcore'` is supplied explicitly on provider routes. */
  explicitInfra: boolean;
  /** For the `none` route: the accompanying (unused) `iac` value. */
  noneIac: IacOption | undefined;
  modelId: string | undefined;
  systemPrompt: string | undefined;
  allowedTools: string[] | undefined;
  maxIterations: number | undefined;
  maxTokens: number | undefined;
  timeoutSeconds: number | undefined;
  /** Random component of this run's unique sentinel tag. */
  sentinelSeed: number;
}

const arbCredentialFreeCandidate: fc.Arbitrary<CredentialFreeCandidate> =
  fc.record({
    route: fc.constantFrom<Route>('cdk', 'terraform', 'none'),
    name: arbValidName,
    explicitInfra: fc.boolean(),
    noneIac: fc.option(
      fc.constantFrom<IacOption>('inherit', 'cdk', 'terraform'),
      { nil: undefined },
    ),
    modelId: fc.option(arbCustomFreeText, { nil: undefined }),
    systemPrompt: fc.option(arbCustomFreeText, { nil: undefined }),
    allowedTools: fc.option(arbCustomAllowedTools, { nil: undefined }),
    maxIterations: fc.option(arbCustomLimit, { nil: undefined }),
    maxTokens: fc.option(arbCustomLimit, { nil: undefined }),
    timeoutSeconds: fc.option(arbCustomLimit, { nil: undefined }),
    sentinelSeed: fc.integer({ min: 0, max: 0xffffffff }),
  });

/** Map a candidate onto the public generator option contract. */
const optionsForCandidate = (
  candidate: CredentialFreeCandidate,
): AgentcoreHarnessGeneratorSchema => {
  const common: AgentcoreHarnessGeneratorSchema = {
    name: candidate.name,
    modelId: candidate.modelId,
    systemPrompt: candidate.systemPrompt,
    allowedTools: candidate.allowedTools,
    maxIterations: candidate.maxIterations,
    maxTokens: candidate.maxTokens,
    timeoutSeconds: candidate.timeoutSeconds,
  };
  switch (candidate.route) {
    case 'cdk':
    case 'terraform':
      return {
        ...common,
        infra: candidate.explicitInfra ? 'agentcore' : undefined,
        iac: candidate.route,
      };
    case 'none':
      return { ...common, infra: 'none', iac: candidate.noneIac };
  }
};

// ---------------------------------------------------------------------------
// Scan helpers
// ---------------------------------------------------------------------------

interface GeneratedFile {
  path: string;
  content: string;
}

/**
 * Every non-deleted (path, content) the run produced, except the planted
 * injection fixture (which necessarily contains the sentinels — it IS the
 * workspace-configuration channel, and a separate assertion proves the
 * generator left it byte-identical). The test workspace starts from an
 * empty backing filesystem, so the change set is the complete generated
 * tree: project files, infrastructure files, metadata (project.json),
 * and dependency declarations (package.json) are all scanned.
 */
const generatedOutput = (tree: Tree): GeneratedFile[] =>
  tree
    .listChanges()
    .filter(
      (change) =>
        change.type !== 'DELETE' &&
        change.path !== PLANTED_WORKSPACE_CONFIG_PATH,
    )
    .map((change) => ({
      path: change.path,
      content: change.content?.toString('utf-8') ?? '',
    }));

/**
 * Collect every (file, needle) pair where the needle appears in the file's
 * content or path. Returned as human-readable descriptions so a property
 * failure names the leaking file and value directly.
 */
const findLeaks = (
  files: GeneratedFile[],
  needles: readonly string[],
): string[] => {
  const leaks: string[] = [];
  for (const file of files) {
    for (const needle of needles) {
      if (file.content.includes(needle)) {
        leaks.push(`content of '${file.path}' contains '${needle}'`);
      }
      if (file.path.includes(needle)) {
        leaks.push(`path '${file.path}' contains '${needle}'`);
      }
    }
  }
  return leaks;
};

/**
 * Strip line comments and block comments from TypeScript source, replacing
 * each with a space so removal can never splice two fragments into a new
 * token. Coarse (string literals containing comment introducers are also
 * stripped) but strictly conservative for a token-absence scan: it only
 * removes text that then cannot be reported, and the generated sources put
 * `credentials` only in a comment.
 */
const stripTsComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const countOccurrences = (content: string, needle: string): number =>
  content.split(needle).length - 1;

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

/** Monotonic run counter: makes every run's sentinel tag unique. */
let runCounter = 0;

describe('agentcore-harness credential-free generated configuration (Property 19)', () => {
  // Feature: agentcore-harness-generator, Property 19: Generated output contains no credential material
  // **Validates: Requirements 7.8, 7.9**
  it('emits no sentinel credential material and no explicit SDK credentials property across the valid option space', async () => {
    await fc.assert(
      fc.asyncProperty(arbCredentialFreeCandidate, async (candidate) => {
        // Run-unique sentinel values: fixed markers (cross-run detection)
        // plus a unique tail (run counter + fuzz-supplied random suffix)
        // that attributes any leaked value to its source run.
        runCounter += 1;
        const runTag = `RUN${runCounter}_${candidate.sentinelSeed
          .toString(16)
          .toUpperCase()}`;
        const sentinelAccessKeyId = `${SENTINEL_MARKERS[0]}${runTag}`;
        const sentinelSecretAccessKey = `${SENTINEL_MARKERS[1]}${runTag}`;
        const sentinelSessionToken = `${SENTINEL_MARKERS[2]}${runTag}`;
        const sentinelValues = [
          sentinelAccessKeyId,
          sentinelSecretAccessKey,
          sentinelSessionToken,
        ];

        // Inject channel 1 — process environment: the exact variables the
        // standard SDK credential provider chain reads first. Originals
        // (possibly real credentials on a developer machine) are saved and
        // restored in the finally block.
        const savedEnv = CREDENTIAL_ENV_KEYS.map(
          (key) => [key, process.env[key]] as const,
        );
        process.env.AWS_ACCESS_KEY_ID = sentinelAccessKeyId;
        process.env.AWS_SECRET_ACCESS_KEY = sentinelSecretAccessKey;
        process.env.AWS_SESSION_TOKEN = sentinelSessionToken;

        try {
          const tree = createTreeUsingTsSolutionSetup();

          // Inject channel 2 — workspace configuration: an AWS-CLI-style
          // config file inside the tree, at a path that is not a Generator
          // input. If the Generator harvested workspace configuration into
          // its output, these sentinels would surface in the scan below.
          const plantedContent = [
            '[default]',
            `aws_access_key_id = ${sentinelAccessKeyId}`,
            `aws_secret_access_key = ${sentinelSecretAccessKey}`,
            `aws_session_token = ${sentinelSessionToken}`,
            '',
          ].join('\n');
          tree.write(PLANTED_WORKSPACE_CONFIG_PATH, plantedContent);

          const options = optionsForCandidate(candidate);
          const resolved = resolveAgentcoreHarnessOptions(tree, options);

          await agentcoreHarnessGenerator(tree, options);

          // The planted fixture is untouched: byte-identity proves the
          // Generator neither consumed nor rewrote it, which legitimizes
          // excluding it from the generated-output leak scan.
          expect(tree.read(PLANTED_WORKSPACE_CONFIG_PATH, 'utf-8')).toBe(
            plantedContent,
          );

          const output = generatedOutput(tree);
          expect(output.length).toBeGreaterThan(0);

          // 7.9 — no sentinel material anywhere in generated output.
          // Scanning for the fixed markers catches every run's sentinels
          // (cross-run contamination included); scanning for this run's
          // exact values keeps the failure message precise.
          expect(
            findLeaks(output, [...sentinelValues, ...SENTINEL_MARKERS]),
          ).toEqual([]);

          // 7.8 — no explicit SDK static-credential property tokens in any
          // generated file (source, metadata, configuration, IaC).
          expect(findLeaks(output, CREDENTIAL_PROPERTY_TOKENS)).toEqual([]);

          // 7.8 — the generated Invocation Client constructs the SDK
          // client with exactly `{ region }`: one constructor call, region
          // as its only property, and no code-level `credentials` token in
          // any generated TypeScript file (the sole legitimate mention is
          // a comment explaining that the default provider chain applies).
          const invokeHarness = tree.read(
            `${resolved.projectRoot}/invoke-harness.ts`,
            'utf-8',
          );
          expect(invokeHarness).toBeDefined();
          expect(
            countOccurrences(invokeHarness!, 'new BedrockAgentCoreClient('),
          ).toBe(1);
          expect(invokeHarness!).toMatch(
            /new BedrockAgentCoreClient\(\s*\{\s*region\s*\}\s*\)/,
          );
          const credentialTokenLeaks = output
            .filter((file) => file.path.endsWith('.ts'))
            .filter((file) =>
              /\bcredentials\b/.test(stripTsComments(file.content)),
            )
            .map((file) => file.path);
          expect(credentialTokenLeaks).toEqual([]);

          // Explicit surfaces named by the property: project metadata and
          // the root dependency declarations carry no sentinel material.
          // (Both files are also covered by the full-output scan above.)
          const projectJson = JSON.stringify(
            readJson(tree, `${resolved.projectRoot}/project.json`),
          );
          const packageJson = JSON.stringify(readJson(tree, 'package.json'));
          for (const needle of [...sentinelValues, ...SENTINEL_MARKERS]) {
            expect(projectJson).not.toContain(needle);
            expect(packageJson).not.toContain(needle);
          }
        } finally {
          // Restore the caller's real environment whatever the outcome.
          for (const [key, value] of savedEnv) {
            if (value === undefined) {
              delete process.env[key];
            } else {
              process.env[key] = value;
            }
          }
        }
      }),
      // At least 100 runs required; 120 gives ~40 full generator runs per
      // route while keeping suite runtime reasonable.
      { numRuns: 120 },
    );
  });
});
