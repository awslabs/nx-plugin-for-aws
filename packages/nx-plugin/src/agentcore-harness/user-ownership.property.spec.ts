/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 16: Generation respects the user-ownership boundary
 * Validates: Requirements 4.6, 10.2, 10.3, 10.4, 10.6, 10.7, 10.9, 10.11, 14.3
 *
 * For all compatible workspaces containing arbitrary User-Owned File
 * contents, unrelated targets, unrelated metadata, other Runtime
 * Configuration entries, unrelated files, and absent, unique, or duplicated
 * Generator-Owned Wiring, generation and the `infra: none` upgrade preserve
 * the original User-Owned File contents byte-for-byte and preserve other
 * user-owned values semantically, while adding only absent Generator-owned
 * artifacts and merge entries.
 *
 * Each case runs the generator, applies user changes (file edits, an extra
 * target, unrelated metadata, unrelated files, wiring-state manipulation),
 * records the exact post-edit state, reruns the generator (same options, or
 * the `infra: agentcore` upgrade run for the upgrade flow), and asserts
 * DIRECTLY against the recorded values:
 *
 * - every user-ownable file's bytes equal the recorded post-edit bytes
 *   (10.2 for project and Generated Infrastructure template paths, 10.7 for
 *   the `infra: none` -> `agentcore` upgrade, 4.6 for the upgrade adding
 *   only absent infrastructure);
 * - the user-defined extra target is deep-equal and the reserved targets
 *   still exist (10.3);
 * - the unrelated metadata value is deep-equal and Generator-owned fields
 *   are present (10.4);
 * - unrelated files outside every merge point are byte-identical (10.9);
 * - user-edited provider files keep their Runtime Configuration lines
 *   byte-for-byte — the file-level reading of 10.6 (the in-template map
 *   semantics are Property 7's);
 * - across absent, unique, and duplicated Generator-Owned Wiring states the
 *   SAME preservation rules hold, while the wiring itself converges
 *   (absent -> restored, unique -> still one, duplicated -> not grown)
 *   (10.11).
 *
 * INDEPENDENCE (14.3): fixtures and assertions here are deliberately
 * independent from wiring-idempotency.property.spec.ts (Property 15).
 * This test edits files between runs and compares the EDITED BYTES
 * directly; it never uses canonical-tree "nothing changed" snapshots, so
 * wiring idempotence/deduplication success can never stand in as
 * preservation evidence (and vice versa).
 *
 * FORMATTER-STABILITY FINDING (investigated before writing this test):
 * `formatFilesInSubtree` formats every file in `tree.listChanges()`. In a
 * real workspace each generator command starts from a fresh on-disk tree,
 * so files the generator did not touch are not in the change set and user
 * edits are truly byte-preserved regardless of formatting style — that
 * contract is exercised end-to-end by the generated-workspace suites. In
 * THIS shared in-memory test tree, however, every file ever written —
 * including a user edit applied between runs — remains in the change set,
 * so the rerun re-formats user-edited files with Biome-formattable
 * extensions (verified empirically: a user edit of `const   weird =    1`
 * in invoke.ts came back as `const weird = 1;\n` after the rerun, while
 * hostile Markdown/Terraform/txt content was byte-preserved because those
 * extensions are not Biome-formattable). The generator itself never
 * rewrites an existing path (`KeepExisting`). To keep byte-equality
 * meaningful under this test-harness artifact, `.ts`/`.json` user edits
 * carry arbitrary payloads inside formatter-stable shells (single-line
 * comments and Biome-style single-quoted exports / 2-space-indented JSON),
 * while `.md`/`.tf`/`.txt` user content is fully arbitrary.
 *
 * Runtime note: every case is two complete generator runs (template
 * rendering plus repository-standard formatting) against a fresh
 * workspace, matching Property 15's measured budget; 100 runs with the
 * explicit timeout below.
 */
import {
  readProjectConfiguration,
  type TargetConfiguration,
  updateProjectConfiguration,
} from '@nx/devkit';
import fc from 'fast-check';
import { sharedConstructsGenerator } from '../utils/shared-constructs';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import { agentcoreHarnessGenerator } from './generator';
import { resolveAgentcoreHarnessOptions } from './resolve-options';
import type { AgentcoreHarnessGeneratorSchema } from './schema';

// ---------------------------------------------------------------------------
// Model: the ownership-boundary contract from the requirements, restated
// independently of the generator implementation (and independently of the
// Property 15 fixtures).
//
// User-Owned File paths (requirements 2.4, 5.1, 6.1): the generated project
// files at the project root and the provider artifact under the Shared
// Infrastructure Project. The Generator-owned merge points are project
// configuration, root package.json dependencies, the CDK index exports, and
// the metrics surface; everything else the user writes must come back
// byte-for-byte identical (10.9).
// ---------------------------------------------------------------------------

const CDK_HARNESSES_INDEX_PATH =
  'packages/common/constructs/src/app/harnesses/index.ts';
const CDK_APP_INDEX_PATH = 'packages/common/constructs/src/app/index.ts';
const cdkConstructPath = (kebab: string): string =>
  `packages/common/constructs/src/app/harnesses/${kebab}/${kebab}.ts`;
const tfModulePath = (kebab: string): string =>
  `packages/common/terraform/src/app/harnesses/${kebab}/${kebab}.tf`;

/** Reserved target contract restated literally from the design. */
const INVOKE_TARGET_CONTRACT = {
  executor: 'nx:run-commands',
  options: { command: 'tsx invoke.ts', cwd: '{projectRoot}' },
};
const BUILD_TARGET_CONTRACT = {
  executor: 'nx:run-commands',
  options: {
    command: 'tsc --noEmit --project tsconfig.json',
    cwd: '{projectRoot}',
  },
};

/**
 * Generator-owned metadata fields (restated from the design's
 * AgentCoreHarnessMetadata). Unrelated metadata keys are chosen outside
 * this set; after the rerun each owned field must still be present.
 */
const OWNED_METADATA_FIELDS = [
  'generator',
  'name',
  'rc',
  'runtimeConfigPath',
  'modelId',
  'systemPrompt',
  'allowedTools',
  'auth',
] as const;

const countOccurrences = (content: string, needle: string): number =>
  content.split(needle).length - 1;

// ---------------------------------------------------------------------------
// User-content builders
// ---------------------------------------------------------------------------

/**
 * Characters safe inside a single-line `//` comment, a single-quoted
 * TypeScript string literal, and a JSON string literal without escaping:
 * no quotes, backslashes, backticks, newlines, or control characters, so
 * the surrounding formatter-stable shell stays a Biome fixed point.
 */
const SAFE_INLINE_CHARS = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  ...' _.,:;@#%&()[]+=!?*<>{}$-',
];

/** Arbitrary inline payload text, trimmed so no line has trailing spaces. */
const arbInlineText = fc
  .string({
    unit: fc.constantFrom(...SAFE_INLINE_CHARS),
    minLength: 1,
    maxLength: 40,
  })
  .map((text) => {
    const trimmed = text.trimEnd();
    return trimmed.length > 0 ? trimmed : 'x';
  });

/**
 * Fully arbitrary user content for extensions no formatter touches
 * (.md, .tf, .txt): raw strings including hostile whitespace, template
 * interpolation look-alikes, quotes, CRLF, and Unicode.
 */
const arbRawContent = fc.oneof(
  fc.string({ maxLength: 120 }),
  fc.string({ unit: 'grapheme', maxLength: 60 }),
  fc.constantFrom(
    '',
    'const   weird =    1',
    '{  "not":   "formatted"  }',
    '# heading\n\n\n\ttabs\t\ttrailing   \n',
    'template ${LOOKS_LIKE_INTERPOLATION} %{directive}',
    `quotes " ' \` and \\backslash\\`,
    'line1\r\nline2\rline3\n',
    'unicode ✓ café 日本語',
  ),
);

/** PascalCase-ish sibling Harness names for user-added RC entries. */
const arbSiblingClass = fc.constantFrom(
  'UserSibling',
  'OtherHarness',
  'SecondEntry',
);

interface TsEditSpec {
  comment: string;
  payload: string;
  siblingClass: string;
}

/**
 * A formatter-stable TypeScript user-edit block carrying the arbitrary
 * payload. Includes a user-owned Runtime Configuration sibling line so
 * byte preservation of the file demonstrates the file-level reading of
 * 10.6 (user RC lines survive the rerun untouched).
 */
const tsUserBlock = (spec: TsEditSpec): string =>
  `// user edit ${spec.comment}\n` +
  `export const userEdit = '${spec.payload}';\n` +
  `// user-owned runtime configuration sibling entry\n` +
  `export const rcSibling = 'agentcore.harnesses.${spec.siblingClass}';\n`;

/** A formatter-stable JSON user edit (Biome style: 2-space indent). */
const jsonUserContent = (payload: string, marker: number): string =>
  `{\n  "userEdited": "${payload}",\n  "userMarker": ${marker}\n}\n`;

/**
 * A Terraform user edit: a user-owned sibling Runtime Configuration entry
 * module plus fully arbitrary trailing content (.tf is never formatted by
 * the generator's formatting hook).
 */
const tfUserContent = (raw: string, siblingClass: string): string =>
  '# user-owned terraform edit\n' +
  `module "user_${siblingClass.toLowerCase()}_runtime_config" {\n` +
  '  source = "../../../core/runtime-config/entry"\n' +
  `  # sibling runtime configuration entry agentcore.harnesses.${siblingClass}\n` +
  '}\n' +
  raw;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

type Route = 'cdk' | 'terraform';
type Flow = 'normal' | 'upgrade';
type WiringState = 'absent' | 'unique' | 'duplicated';

const containsNonWhitespace = (value: string): boolean => /\S/.test(value);

/** Valid names covering the interesting normalization shapes. */
const arbValidName = fc
  .tuple(
    fc.constantFrom('harness', 'My Harness', 'ownerBoundary2', 'café'),
    fc.string({ maxLength: 8 }),
  )
  .map(([seed, decoration]) => seed + decoration);

const arbDirectory = fc.option(fc.constantFrom('packages', 'apps'), {
  nil: undefined,
});
const arbSubDirectory = fc.option(
  fc.constantFrom('owner-home', 'nested/leaf'),
  {
    nil: undefined,
  },
);

/** Optional custom creation options (varies the generated content edited). */
const arbCustomFreeText = fc.oneof(
  fc.string({ minLength: 1, maxLength: 30 }).filter(containsNonWhitespace),
  fc.constantFrom(
    'custom.model-id',
    'Prompt with "quotes", \\backslashes\\ and\nnewlines.',
  ),
);

const arbTsEditSpec: fc.Arbitrary<TsEditSpec> = fc.record({
  comment: arbInlineText,
  payload: arbInlineText,
  siblingClass: arbSiblingClass,
});

interface ProviderEditSpec {
  /** append keeps the generated content (and its RC registration line). */
  mode: 'replace' | 'append';
  ts: TsEditSpec;
  tfRaw: string;
}

const arbProviderEdit: fc.Arbitrary<ProviderEditSpec> = fc.record({
  mode: fc.constantFrom<'replace' | 'append'>('replace', 'append'),
  ts: arbTsEditSpec,
  tfRaw: arbRawContent,
});

/** Unrelated file slots: paths outside every Generator-owned merge point. */
const unrelatedFilePath = (slot: number, projectRoot: string): string =>
  [`${projectRoot}/notes.txt`, 'docs/user-notes.md', 'tools/scratch-pad.txt'][
    slot
  ];

interface Candidate {
  flow: Flow;
  route: Route;
  name: string;
  directory: string | undefined;
  subDirectory: string | undefined;
  modelId: string | undefined;
  systemPrompt: string | undefined;
  allowedTools: string[] | undefined;
  maxIterations: number | undefined;
  editInvoke: TsEditSpec | undefined;
  editReadme: string | undefined;
  editTsconfig: { payload: string; marker: number } | undefined;
  providerEdit: ProviderEditSpec | undefined;
  extraTargetName: string;
  extraTargetExecutor: string;
  extraTargetCommand: string;
  unrelatedMetadataKey: string;
  unrelatedMetadataValue: unknown;
  unrelatedFiles: { slot: number; content: string }[];
  wiring: WiringState;
}

const arbCandidate: fc.Arbitrary<Candidate> = fc.record({
  flow: fc.constantFrom<Flow>('normal', 'upgrade'),
  route: fc.constantFrom<Route>('cdk', 'terraform'),
  name: arbValidName,
  directory: arbDirectory,
  subDirectory: arbSubDirectory,
  modelId: fc.option(arbCustomFreeText, { nil: undefined }),
  systemPrompt: fc.option(arbCustomFreeText, { nil: undefined }),
  allowedTools: fc.option(
    fc.array(arbInlineText, { minLength: 1, maxLength: 4 }),
    { nil: undefined },
  ),
  maxIterations: fc.option(fc.integer({ min: 1, max: 100_000 }), {
    nil: undefined,
  }),
  editInvoke: fc.option(arbTsEditSpec, { nil: undefined }),
  editReadme: fc.option(arbRawContent, { nil: undefined }),
  editTsconfig: fc.option(
    fc.record({ payload: arbInlineText, marker: fc.nat({ max: 999_999 }) }),
    { nil: undefined },
  ),
  providerEdit: fc.option(arbProviderEdit, { nil: undefined }),
  extraTargetName: fc.constantFrom(
    'deploy',
    'lint-docs',
    'e2e-smoke',
    'publish',
  ),
  extraTargetExecutor: fc.constantFrom('nx:run-commands', '@acme/custom:run'),
  extraTargetCommand: fc.oneof(
    fc.string({ maxLength: 60 }),
    fc.constantFrom('echo "user command" && exit 0', 'tsx custom\ttool.ts'),
  ),
  unrelatedMetadataKey: fc.constantFrom(
    'userNote',
    'team',
    'customAnnotations',
    'reviewedBy',
  ),
  unrelatedMetadataValue: fc.oneof(
    fc.string({ maxLength: 40 }),
    fc.integer(),
    fc.boolean(),
    fc.array(fc.string({ maxLength: 10 }), { maxLength: 3 }),
    fc.record({ note: fc.string({ maxLength: 20 }) }),
  ),
  unrelatedFiles: fc.uniqueArray(
    fc.record({ slot: fc.constantFrom(0, 1, 2), content: arbRawContent }),
    { selector: (file) => file.slot, minLength: 1, maxLength: 3 },
  ),
  wiring: fc.constantFrom<WiringState>('absent', 'unique', 'duplicated'),
});

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('agentcore-harness user-ownership boundary (Property 16)', () => {
  // Feature: agentcore-harness-generator, Property 16: Generation respects the user-ownership boundary
  // **Validates: Requirements 4.6, 10.2, 10.3, 10.4, 10.6, 10.7, 10.9, 10.11, 14.3**
  it('reruns and infra upgrades preserve user-owned bytes, targets, metadata, and unrelated files across wiring states', async () => {
    await fc.assert(
      fc.asyncProperty(arbCandidate, async (candidate) => {
        const tree = createTreeUsingTsSolutionSetup();

        // ------------------------------------------------------------------
        // Run 1: establish the workspace (provider route, or `infra: none`
        // for the upgrade flow).
        // ------------------------------------------------------------------
        const creationOptions: AgentcoreHarnessGeneratorSchema = {
          name: candidate.name,
          directory: candidate.directory,
          subDirectory: candidate.subDirectory,
          modelId: candidate.modelId,
          systemPrompt: candidate.systemPrompt,
          allowedTools: candidate.allowedTools,
          maxIterations: candidate.maxIterations,
        };
        const run1Options: AgentcoreHarnessGeneratorSchema =
          candidate.flow === 'normal'
            ? { ...creationOptions, iac: candidate.route }
            : { ...creationOptions, infra: 'none' };
        const resolved = resolveAgentcoreHarnessOptions(tree, run1Options);
        const kebab = resolved.nameKebabCase;
        const fqn = resolved.fullyQualifiedProjectName;
        const projectRoot = resolved.projectRoot;
        const providerPath =
          candidate.route === 'cdk'
            ? cdkConstructPath(kebab)
            : tfModulePath(kebab);

        await agentcoreHarnessGenerator(tree, run1Options);

        // ------------------------------------------------------------------
        // User changes between runs.
        // ------------------------------------------------------------------

        // File edits at User-Owned File paths (formatter-stable shells for
        // .ts/.json — see the header — raw arbitrary content for .md/.tf).
        if (candidate.editInvoke) {
          tree.write(
            `${projectRoot}/invoke.ts`,
            tsUserBlock(candidate.editInvoke),
          );
        }
        if (candidate.editReadme !== undefined) {
          tree.write(`${projectRoot}/README.md`, candidate.editReadme);
        }
        if (candidate.editTsconfig) {
          tree.write(
            `${projectRoot}/tsconfig.json`,
            jsonUserContent(
              candidate.editTsconfig.payload,
              candidate.editTsconfig.marker,
            ),
          );
        }
        if (candidate.providerEdit) {
          if (candidate.flow === 'normal') {
            // Edit the existing provider artifact. `append` keeps the
            // generated content — including its Runtime Configuration
            // registration line — ahead of the user block.
            const generated = tree.read(providerPath, 'utf-8')!;
            const userBlock =
              candidate.route === 'cdk'
                ? tsUserBlock(candidate.providerEdit.ts)
                : tfUserContent(
                    candidate.providerEdit.tfRaw,
                    candidate.providerEdit.ts.siblingClass,
                  );
            tree.write(
              providerPath,
              candidate.providerEdit.mode === 'append'
                ? generated + userBlock
                : userBlock,
            );
          } else {
            // Upgrade flow: no provider artifact exists after `infra:
            // none`. Pre-create user content AT the Generated
            // Infrastructure template path; the upgrade run must keep it
            // (10.2) while still wiring the infrastructure around it.
            //
            // The Shared Infrastructure Project is seeded first: 10.2's
            // precondition is a User-Owned File in a compatible workspace,
            // and a file inside a not-yet-scaffolded shared project's src
            // tree is not one — the repository-standard shared-project
            // scaffolding (existing behaviour outside this feature)
            // resets `src` when it creates the project.
            await sharedConstructsGenerator(tree, { iac: candidate.route });
            tree.write(
              providerPath,
              candidate.route === 'cdk'
                ? tsUserBlock(candidate.providerEdit.ts)
                : tfUserContent(
                    candidate.providerEdit.tfRaw,
                    candidate.providerEdit.ts.siblingClass,
                  ),
            );
          }
        }

        // A user-defined extra target and unrelated metadata (10.3, 10.4).
        const extraTarget: TargetConfiguration = {
          executor: candidate.extraTargetExecutor,
          options: {
            command: candidate.extraTargetCommand,
            cwd: '{projectRoot}',
          },
        };
        const projectBefore = readProjectConfiguration(tree, fqn);
        projectBefore.targets = {
          ...projectBefore.targets,
          [candidate.extraTargetName]: extraTarget,
        };
        projectBefore.metadata = {
          ...projectBefore.metadata,
          [candidate.unrelatedMetadataKey]: candidate.unrelatedMetadataValue,
        } as typeof projectBefore.metadata;
        updateProjectConfiguration(tree, fqn, projectBefore);

        // Unrelated files outside every Generator-owned merge point (10.9).
        for (const file of candidate.unrelatedFiles) {
          tree.write(unrelatedFilePath(file.slot, projectRoot), file.content);
        }

        // Generator-Owned Wiring state manipulation (10.11). Only the
        // normal CDK flow has index-export wiring between runs: Terraform
        // wiring lives in the module file itself, and the upgrade flow has
        // no wiring at all until the upgrade run creates it.
        const effectiveWiring: WiringState =
          candidate.flow === 'normal' && candidate.route === 'cdk'
            ? candidate.wiring
            : 'unique';
        const harnessExportNeedle = `export * from './${kebab}/${kebab}.js'`;
        if (effectiveWiring === 'absent') {
          const index = tree.read(CDK_HARNESSES_INDEX_PATH, 'utf-8')!;
          tree.write(
            CDK_HARNESSES_INDEX_PATH,
            index
              .split('\n')
              .filter((line) => !line.includes(`${kebab}/${kebab}.js`))
              .join('\n'),
          );
        } else if (effectiveWiring === 'duplicated') {
          const index = tree.read(CDK_HARNESSES_INDEX_PATH, 'utf-8')!;
          tree.write(
            CDK_HARNESSES_INDEX_PATH,
            `${index}${harnessExportNeedle};\n`,
          );
        }

        // ------------------------------------------------------------------
        // Record the exact post-edit user-owned state the rerun must
        // preserve. Every user-ownable file is recorded (edited subset with
        // user bytes, the rest with their existing contents) so comparison
        // is DIRECT per-file byte equality, never a tree-level snapshot.
        // ------------------------------------------------------------------
        const userOwnedPaths = [
          `${projectRoot}/invoke.ts`,
          `${projectRoot}/README.md`,
          `${projectRoot}/tsconfig.json`,
          ...(tree.exists(providerPath) ? [providerPath] : []),
          ...candidate.unrelatedFiles.map((file) =>
            unrelatedFilePath(file.slot, projectRoot),
          ),
        ];
        const expectedBytes = Object.fromEntries(
          userOwnedPaths.map((path) => [path, tree.read(path, 'utf-8')]),
        );

        // ------------------------------------------------------------------
        // Run 2: the equivalent rerun, or the `infra: agentcore` upgrade.
        // ------------------------------------------------------------------
        const run2Options: AgentcoreHarnessGeneratorSchema =
          candidate.flow === 'normal'
            ? {
                ...run1Options,
                allowedTools: run1Options.allowedTools
                  ? [...run1Options.allowedTools]
                  : undefined,
              }
            : {
                name: candidate.name,
                directory: candidate.directory,
                subDirectory: candidate.subDirectory,
                infra: 'agentcore',
                iac: candidate.route,
              };
        await agentcoreHarnessGenerator(tree, run2Options);

        // ------------------------------------------------------------------
        // Direct byte comparison of every recorded user-owned path
        // (10.2, 10.6 file-level, 10.7, 10.9, and 10.11's same-rules
        // clause across all wiring states).
        // ------------------------------------------------------------------
        const actualBytes = Object.fromEntries(
          userOwnedPaths.map((path) => [path, tree.read(path, 'utf-8')]),
        );
        expect(actualBytes).toEqual(expectedBytes);

        // The upgrade adds the selected Generated Infrastructure (4.6);
        // for the normal flow the artifact simply still exists.
        expect(tree.exists(providerPath)).toBe(true);

        // User-defined target deep-equal and reserved targets present
        // (10.3); unrelated metadata deep-equal and Generator-owned fields
        // present (10.4).
        const projectAfter = readProjectConfiguration(tree, fqn);
        expect(projectAfter.targets?.[candidate.extraTargetName]).toEqual(
          extraTarget,
        );
        expect(projectAfter.targets?.invoke).toEqual(INVOKE_TARGET_CONTRACT);
        expect(projectAfter.targets?.build).toEqual(BUILD_TARGET_CONTRACT);
        const metadataAfter = (projectAfter.metadata ?? {}) as Record<
          string,
          unknown
        >;
        expect(metadataAfter[candidate.unrelatedMetadataKey]).toEqual(
          candidate.unrelatedMetadataValue,
        );
        for (const field of OWNED_METADATA_FIELDS) {
          expect(metadataAfter[field]).toBeDefined();
        }

        // Wiring-state convergence (10.11): absent -> restored, unique ->
        // still one, duplicated -> not grown — while every byte assertion
        // above held under the same rules in all three states.
        if (candidate.route === 'cdk') {
          const harnessesIndex = tree.read(CDK_HARNESSES_INDEX_PATH, 'utf-8')!;
          expect(countOccurrences(harnessesIndex, harnessExportNeedle)).toBe(
            effectiveWiring === 'duplicated' ? 2 : 1,
          );
          expect(
            countOccurrences(
              tree.read(CDK_APP_INDEX_PATH, 'utf-8')!,
              "export * from './harnesses/index.js'",
            ),
          ).toBe(1);
        }
      }),
      // At least 100 runs required; each case is two full generator runs,
      // matching the budget established by the Property 15 suite.
      { numRuns: 100 },
    );
  }, 300_000);
});
