/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 6: Generated default Harness Names satisfy service constraints
 * Validates: Requirements 5.4, 6.5
 *
 * For all valid Generator names and all generated uniqueness suffixes, each
 * CDK and Terraform default Harness Name starts with an ASCII letter,
 * contains only ASCII letters, digits, or underscores, retains its
 * collision-resistant suffix, and contains at most 40 characters.
 *
 * Neither provider computes its default name at generation time: the CDK
 * construct derives it at synth time (`Names.uniqueResourceName` + H-prefix
 * post-processing) and the Terraform module derives it at plan time
 * (`substr`/`regexall` locals + `random_id` suffix). The property therefore
 * tests FAITHFUL TYPESCRIPT MIRRORS of both name-construction expressions
 * across the full generated input space, and separately TIES each mirror to
 * the rendered template with content-level assertions (exact rendered
 * Terraform locals for the resolved class name; the CDK `maxLength: 39` /
 * `'_'` / H-prefix conditional). The tie is what makes the mirror results
 * evidence about the templates rather than about the test itself.
 */
import type { Tree } from '@nx/devkit';
import fc from 'fast-check';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { agentcoreHarnessGenerator } from './generator';
import { resolveAgentcoreHarnessOptions } from './resolve-options';

// ---------------------------------------------------------------------------
// Model: the shared Harness Name constraints from the requirements glossary,
// restated independently of both implementations as the oracle for every
// default name either provider can deploy.
//
// - starts with an ASCII letter,
// - contains only ASCII letters, digits, or underscores,
// - contains no more than 40 characters.
// ---------------------------------------------------------------------------

const HARNESS_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const HARNESS_NAME_MAX_LENGTH = 40;

const expectServiceSafeHarnessName = (name: string): void => {
  expect(name).toMatch(HARNESS_NAME_PATTERN);
  expect(name.length).toBeLessThanOrEqual(HARNESS_NAME_MAX_LENGTH);
};

// ---------------------------------------------------------------------------
// Mirrors of the two template name-construction expressions.
// ---------------------------------------------------------------------------

/**
 * Faithful mirror of the Terraform module locals (tied to the rendered
 * module byte-for-byte by the template-tie property below):
 *
 *   harness_name_prefix = substr(length(regexall("^[A-Za-z]", "<cn>")) > 0
 *                           ? "<cn>" : "H<cn>", 0, 31)
 *   harness_name        = "${local.harness_name_prefix}_${random_id.unique_suffix.hex}"
 *
 * Terraform's `substr(s, 0, 31)` counts unicode code points, but rendered
 * class names are ASCII-only (`^_?[A-Za-z0-9]+$`), so `slice(0, 31)` is
 * equivalent; `regexall` uses RE2 whose `^[A-Za-z]` matches JavaScript's on
 * this newline-free input space.
 */
const terraformDefaultHarnessName = (
  nameClassName: string,
  hexSuffix: string,
): string => {
  const prefixSource = /^[A-Za-z]/.test(nameClassName)
    ? nameClassName
    : `H${nameClassName}`;
  return `${prefixSource.slice(0, 31)}_${hexSuffix}`;
};

/**
 * Faithful mirror of the CDK construct's synth-time post-processing (tied
 * to the rendered construct by the template-tie property below):
 *
 *   harnessName = harnessProps.harnessName ??
 *     (/^[A-Za-z]/.test(uniqueName) ? uniqueName : `H${uniqueName}`)
 *
 * The property quantifies over every `Names.uniqueResourceName`-shaped
 * input instead of calling CDK at test time: with `{ maxLength: 39,
 * separator: '_', allowedSpecialCharacters: '_' }` the documented output
 * contract is a non-empty string of at most 39 ASCII letters, digits, or
 * underscores ending in a hash suffix. The generated space below is a
 * superset of that contract, so the mirror result holds for every real
 * synth-time output.
 */
const cdkDefaultHarnessName = (uniqueName: string): string =>
  /^[A-Za-z]/.test(uniqueName) ? uniqueName : `H${uniqueName}`;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const ALNUM_CHARS = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
];

/**
 * Long names whose class names exceed the 31-character Terraform prefix
 * budget, forcing truncation. Every character is ASCII alphanumeric, so
 * normalization preserves the character count and the class name length is
 * at least 32 (plus a possible `_` prefix for digit-leading names).
 */
const arbLongName = fc.string({
  unit: fc.constantFrom(...ALNUM_CHARS),
  minLength: 32,
  maxLength: 72,
});

/**
 * Numeric-leading names: `toClassName` prefixes `_` for a digit-leading
 * first word, producing exactly the non-letter-leading class names the
 * H-prefix branch exists for.
 */
const arbNumericLeadingName = fc
  .tuple(
    fc.constantFrom('3d', '1st-harness', '42', '0-day', '7'),
    fc.string({
      unit: fc.constantFrom('a', 'z', '0', '9', '-', '_'),
      maxLength: 10,
    }),
  )
  .map(([seed, tail]) => seed + tail);

/**
 * Symbol-heavy names that still normalize to non-empty identifiers (names
 * normalizing to empty identifiers are rejected before any template is
 * rendered - Property 2 territory). Seeds guarantee at least one ASCII
 * alphanumeric survives normalization; arbitrary decoration varies the
 * surrounding hostility.
 */
const arbSymbolHeavyName = fc
  .tuple(
    fc.constantFrom(
      'a_b.c!',
      '$$money$$',
      'my@harness#2',
      'héllo wörld',
      'x!!y??z',
      '_..3d..harness..',
    ),
    fc.string({ maxLength: 8 }),
  )
  .map(([seed, decoration]) => seed + decoration);

/** Ordinary names, including a single-letter minimum. */
const arbOrdinaryName = fc.constantFrom(
  'harness',
  'my-harness',
  'MyHarness2',
  'names',
  'p6-harness',
  'z',
);

/** Valid Generator names across the four shapes named by the task. */
const arbGeneratorName = fc.oneof(
  arbLongName,
  arbNumericLeadingName,
  arbSymbolHeavyName,
  arbOrdinaryName,
);

/**
 * `random_id.unique_suffix.hex` with `byte_length = 4` is exactly eight
 * lowercase hex characters; digit-leading suffixes occur naturally.
 */
const arbHexSuffix = fc.string({
  unit: fc.constantFrom(...'0123456789abcdef'.split('')),
  minLength: 8,
  maxLength: 8,
});

const IDENTIFIER_CHARS = [...ALNUM_CHARS, '_'];

/** CDK unique-name hash suffixes are uppercase hex. */
const arbCdkHash = fc.string({
  unit: fc.constantFrom(...'0123456789ABCDEF'.split('')),
  minLength: 8,
  maxLength: 8,
});

/**
 * Superset of the `Names.uniqueResourceName` output contract for
 * `{ maxLength: 39, separator: '_', allowedSpecialCharacters: '_' }`:
 * non-empty strings of at most 39 ASCII letters, digits, or underscores.
 * Adversarial digit-leading and underscore-leading heads are generated
 * explicitly because the H-prefix branch exists exactly for them, and the
 * realistic path-derived-prefix-plus-hash shape keeps the hash suffix
 * observable for the retention assertion.
 */
const arbUniqueResourceName = fc.oneof(
  // Realistic shape: path-derived prefix (possibly empty) + 8-char hash.
  fc
    .tuple(
      fc.oneof(
        fc.string({
          unit: fc.constantFrom(...IDENTIFIER_CHARS),
          maxLength: 31,
        }),
        // Force non-letter-leading heads.
        fc
          .tuple(
            fc.constantFrom('0', '9', '_', '1'),
            fc.string({
              unit: fc.constantFrom(...IDENTIFIER_CHARS),
              maxLength: 30,
            }),
          )
          .map(([head, tail]) => head + tail),
      ),
      arbCdkHash,
    )
    .map(([prefix, hash]) => `${prefix}${hash}`),
  // Full over-approximation of the output contract.
  fc.string({
    unit: fc.constantFrom(...IDENTIFIER_CHARS),
    minLength: 1,
    maxLength: 39,
  }),
);

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

const cdkConstructPath = (kebab: string): string =>
  `packages/common/constructs/src/app/harnesses/${kebab}/${kebab}.ts`;
const tfModulePath = (kebab: string): string =>
  `packages/common/terraform/src/app/harnesses/${kebab}/${kebab}.tf`;

describe('agentcore-harness generated default Harness Names (Property 6)', () => {
  let tree: Tree;

  beforeEach(() => {
    tree = createTreeUsingTsSolutionSetup();
  });

  // Feature: agentcore-harness-generator, Property 6: Generated default Harness Names satisfy service constraints
  // **Validates: Requirements 5.4, 6.5**
  it('terraform: every valid Generator name and random suffix yields a service-safe default name retaining the suffix', () => {
    fc.assert(
      fc.property(arbGeneratorName, arbHexSuffix, (name, hexSuffix) => {
        // The class name embedded into the rendered module is the resolved
        // identity of the Generator name (resolution never mutates the
        // tree, so one workspace serves every run).
        const { nameClassName } = resolveAgentcoreHarnessOptions(tree, {
          name,
        });
        // Every generated shape normalizes to a usable identifier; an
        // empty class name here would be an arbitrary-generation bug.
        expect(nameClassName).not.toBe('');

        const harnessName = terraformDefaultHarnessName(
          nameClassName,
          hexSuffix,
        );

        // The shared service constraints (requirements glossary).
        expectServiceSafeHarnessName(harnessName);

        // The collision-resistant random suffix is retained verbatim, so
        // prefix truncation can never eat into collision resistance.
        expect(harnessName.endsWith(`_${hexSuffix}`)).toBe(true);

        // Truncation engages exactly when the letter-leading prefix source
        // exceeds 31 characters, landing precisely on the 40-char limit.
        const prefixSource = /^[A-Za-z]/.test(nameClassName)
          ? nameClassName
          : `H${nameClassName}`;
        expect(harnessName.length).toBe(Math.min(prefixSource.length, 31) + 9);
      }),
      // At least 100 runs required; 300 across the four name shapes.
      { numRuns: 300 },
    );
  });

  // Feature: agentcore-harness-generator, Property 6: Generated default Harness Names satisfy service constraints
  // **Validates: Requirements 5.4, 6.5**
  it('cdk: every uniqueResourceName-shaped synth name post-processes to a service-safe default name retaining the unique suffix', () => {
    fc.assert(
      fc.property(arbUniqueResourceName, (uniqueName) => {
        const harnessName = cdkDefaultHarnessName(uniqueName);

        // The shared service constraints: 39-char synth names plus the
        // conditional leading 'H' stay within the 40-character limit.
        expectServiceSafeHarnessName(harnessName);

        // Post-processing only ever prepends 'H'; it never truncates or
        // reorders, so the collision-resistant hash suffix embedded in the
        // unique name survives verbatim.
        expect(harnessName.endsWith(uniqueName)).toBe(true);
        expect(harnessName.length).toBeLessThanOrEqual(uniqueName.length + 1);
      }),
      // At least 100 runs required; 300 across adversarial head shapes.
      { numRuns: 300 },
    );
  });

  // Feature: agentcore-harness-generator, Property 6: Generated default Harness Names satisfy service constraints
  // **Validates: Requirements 5.4, 6.5**
  it('renders exactly the mirrored name-construction logic into both providers', async () => {
    // Full generator runs are comparatively slow (template rendering and
    // formatting), so this template-tie reinforcement uses a bounded run
    // count; the >=100-run requirement is satisfied by the mirror
    // properties above. Without this tie the mirrors would prove nothing
    // about the templates.
    await fc.assert(
      fc.asyncProperty(arbGeneratorName, async (name) => {
        const cdkTree = createTreeUsingTsSolutionSetup();
        const resolved = resolveAgentcoreHarnessOptions(cdkTree, { name });

        // CDK: one full generator run, then content-level assertions that
        // the rendered construct computes the mirrored expression.
        await agentcoreHarnessGenerator(cdkTree, { name, iac: 'cdk' });
        const construct = cdkTree.read(
          cdkConstructPath(resolved.nameKebabCase),
          'utf-8',
        );
        expect(construct).not.toBeNull();
        // Synth names are capped at 39 chars of letters/digits/underscores
        // (one char of headroom for the conditional 'H').
        expect(construct).toMatch(
          /Names\.uniqueResourceName\(this,\s*\{\s*maxLength:\s*39,\s*separator:\s*'_',\s*allowedSpecialCharacters:\s*'_',?\s*\}\)/,
        );
        // The H-prefix conditional mirrored by cdkDefaultHarnessName.
        expect(construct).toMatch(
          /harnessProps\.harnessName\s*\?\?\s*\(\/\^\[A-Za-z\]\/\.test\(uniqueName\)\s*\?\s*uniqueName\s*:\s*`H\$\{uniqueName\}`\)/,
        );
        // The effective name is what the native resource deploys.
        expect(construct).toMatch(/\n\s*harnessName,\n/);

        // Terraform: one full generator run, then byte-exact assertions
        // that the rendered locals equal the mirrored expression for this
        // resolved class name (class names are [A-Za-z0-9_], so plain
        // substring matching cannot be confused by metacharacters).
        const terraformTree = createTreeUsingTsSolutionSetup();
        await agentcoreHarnessGenerator(terraformTree, {
          name,
          iac: 'terraform',
        });
        const module = terraformTree.read(
          tfModulePath(resolved.nameKebabCase),
          'utf-8',
        );
        expect(module).not.toBeNull();
        const cn = resolved.nameClassName;
        expect(module).toContain(
          `harness_name_prefix = substr(length(regexall("^[A-Za-z]", "${cn}")) > 0 ? "${cn}" : "H${cn}", 0, 31)`,
        );
        expect(module).toContain(
          'harness_name        = "${local.harness_name_prefix}_${random_id.unique_suffix.hex}"',
        );
        // The suffix is eight hex chars: a 4-byte random_id rendered as hex.
        expect(module).toMatch(
          /resource "random_id" "unique_suffix" \{\s*byte_length = 4\s*\}/,
        );
        // The deployed resource consumes exactly the constructed local.
        expect(module).toMatch(/\n\s*harness_name\s+=\s+local\.harness_name\n/);
      }),
      { numRuns: 16 },
    );
  }, 120_000);
});
