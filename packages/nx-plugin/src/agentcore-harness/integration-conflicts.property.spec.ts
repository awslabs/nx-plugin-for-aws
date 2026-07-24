/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Feature: agentcore-harness-generator, Property 17: Integration conflicts are classified and fail before tree mutation
 * Validates: Requirements 4.9, 10.8, 10.10, 11.9
 *
 * For all schema-valid Generator options and existing workspaces exhibiting
 * foreign Harness Project ownership, an incompatible project root, an
 * incompatible reserved target, a mismatch between an explicitly supplied
 * creation option and persisted Generator-owned metadata, or an explicitly
 * selected IaC provider different from the existing Shared Infrastructure
 * Project provider, generation fails before tree mutation and reports a
 * diagnostic identifying the conflicting integration surface.
 * Provider-mismatch diagnostics name both providers, and project-conflict
 * diagnostics are not labeled as schema-validation errors.
 *
 * Runtime note: three of the five conflict kinds require a real setup run
 * (a successful generator run to persist metadata/targets, or a Shared
 * Infrastructure Project generation), so each such case costs two generator
 * runs. At 120 mixed-kind runs this stays well within the suite's per-test
 * budget while giving roughly 24 cases per conflict kind.
 */
import {
  addProjectConfiguration,
  readProjectConfiguration,
  type TargetConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import fc from 'fast-check';
import { sharedConstructsGenerator } from '../utils/shared-constructs';
import { createTreeUsingTsSolutionSetup } from '../utils/test';
import {
  AGENTCORE_HARNESS_GENERATOR_INFO,
  agentcoreHarnessGenerator,
} from './generator';
import {
  DEFAULT_HARNESS_ALLOWED_TOOLS,
  DEFAULT_HARNESS_MODEL_ID,
  DEFAULT_HARNESS_SYSTEM_PROMPT,
  resolveAgentcoreHarnessOptions,
} from './resolve-options';
import type { AgentcoreHarnessGeneratorSchema } from './schema';

// ---------------------------------------------------------------------------
// Model: the integration-conflict contract from the requirements, restated
// independently of the preflight implementation.
//
// - 10.8: a normalized target project that belongs to a different generator
//   or resolves to an incompatible project root terminates generation with a
//   conflict diagnostic before that project is modified.
// - 10.10: an existing reserved `invoke`/`build` target that differs from
//   the Generator target contract is reported as a target conflict before
//   the Harness Project is modified.
// - 11.9: when schema validation accepted every supplied option, these
//   project conflicts (including an explicitly supplied creation option that
//   mismatches persisted Generator-owned metadata) produce a dedicated
//   integration-conflict diagnostic that identifies the conflicting
//   integration surface and is not labeled as a schema-validation error.
// - 4.9: an explicitly selected IaC provider that differs from the provider
//   of an existing Shared Infrastructure Project is reported in a diagnostic
//   naming both providers, terminating before the Nx tree is modified.
//
// "Fails before tree mutation" is modeled directly: the serialized tree
// change set (path, change type, and file bytes) is captured after conflict
// setup and must be exactly equal after the failing run.
// ---------------------------------------------------------------------------

/** Classification prefix shared by every integration-conflict diagnostic. */
const INTEGRATION_CONFLICT_PREFIX = /^Integration conflict: /;

/** The label reserved for schema-validation errors (11.9 exclusion). */
const SCHEMA_ERROR_LABEL = 'Invalid option';

/** Creation options persisted in Generator-owned metadata. */
type PersistedOption =
  | 'modelId'
  | 'systemPrompt'
  | 'allowedTools'
  | 'maxIterations'
  | 'maxTokens'
  | 'timeoutSeconds';

const LIMIT_OPTIONS: readonly PersistedOption[] = [
  'maxIterations',
  'maxTokens',
  'timeoutSeconds',
];

/**
 * Documented creation defaults persisted when a string/array creation option
 * is omitted at creation (omitted execution limits are not persisted, so a
 * limit conflict always seeds an explicit initial value).
 */
const PERSISTED_DEFAULTS: Record<string, string | string[]> = {
  modelId: DEFAULT_HARNESS_MODEL_ID,
  systemPrompt: DEFAULT_HARNESS_SYSTEM_PROMPT,
  allowedTools: [...DEFAULT_HARNESS_ALLOWED_TOOLS],
};

type ReservedTarget = 'invoke' | 'build';
type TargetCorruption = 'command' | 'executor' | 'extraOption' | 'emptyTarget';
type Provider = 'cdk' | 'terraform';

type CreationOptions = Pick<AgentcoreHarnessGeneratorSchema, PersistedOption>;

interface ForeignOwnershipScenario {
  kind: 'foreignOwnership';
  /** `undefined` models a project with no generator metadata at all. */
  owner: string | undefined;
  creation: CreationOptions;
}

interface IncompatibleRootScenario {
  kind: 'incompatibleRoot';
  existingRootSeed: string;
  directory: string | undefined;
  subDirectory: string | undefined;
}

interface ReservedTargetScenario {
  kind: 'incompatibleReservedTarget';
  target: ReservedTarget;
  corruption: TargetCorruption;
  commandSuffix: string;
  creation: CreationOptions;
}

interface OptionVsPersistedScenario {
  kind: 'explicitOptionVsPersisted';
  option: PersistedOption;
  /** Whether the creation run supplies the option or relies on the default. */
  supplyInitial: boolean;
  initialText: string;
  initialTools: string[];
  initialLimit: number;
  conflictText: string;
  conflictTools: string[];
  conflictLimit: number;
}

interface ProviderMismatchScenario {
  kind: 'explicitProviderMismatch';
  existingProvider: Provider;
  /** `infra: 'agentcore'` supplied explicitly or resolved as the default. */
  explicitInfra: boolean;
}

type ConflictScenario =
  | ForeignOwnershipScenario
  | IncompatibleRootScenario
  | ReservedTargetScenario
  | OptionVsPersistedScenario
  | ProviderMismatchScenario;

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const containsNonWhitespace = (value: string): boolean => /\S/.test(value);

/**
 * Valid human-readable names. Seeds cover the interesting normalization
 * shapes (spaces, camelCase humps, digit-leading words, accents, embedded
 * punctuation) and guarantee the name normalizes to a non-empty identifier
 * that can never collide with the Shared Infrastructure Project names;
 * decoration varies the rest.
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
  .map(([seed, decoration]) => seed + decoration);

/** Schema-valid free text for model IDs and system prompts. */
const arbFreeText = fc.oneof(
  fc.string({ minLength: 1, maxLength: 30 }).filter(containsNonWhitespace),
  fc.constantFrom(
    'custom.model-id',
    'Prompt with "quotes", \\backslashes\\ and\nnewlines.',
    'unicode tëxt ✓',
  ),
);

/** Schema-valid allowed-tool arrays (1 through 6 non-whitespace entries). */
const arbTools = fc.array(
  fc.oneof(
    fc.constant('@builtin'),
    fc.string({ minLength: 1, maxLength: 12 }).filter(containsNonWhitespace),
  ),
  { minLength: 1, maxLength: 6 },
);

/** Schema-valid positive execution limits. */
const arbLimit = fc.integer({ min: 1, max: 2_000_000 });

/** Optional schema-valid creation options accompanying a conflicting run. */
const arbCreationOptions: fc.Arbitrary<CreationOptions> = fc.record({
  modelId: fc.option(arbFreeText, { nil: undefined }),
  systemPrompt: fc.option(arbFreeText, { nil: undefined }),
  allowedTools: fc.option(arbTools, { nil: undefined }),
  maxIterations: fc.option(arbLimit, { nil: undefined }),
  maxTokens: fc.option(arbLimit, { nil: undefined }),
  timeoutSeconds: fc.option(arbLimit, { nil: undefined }),
});

/**
 * Foreign owners: another generator's id, an empty id, or `undefined` for a
 * project without generator metadata. Never the agentcore-harness id.
 */
const arbForeignOwner = fc.option(
  fc
    .oneof(
      fc.constantFrom('ts#project', 'py#fast-api', ''),
      fc.string({
        unit: fc.constantFrom('a', 'g', 'e', 'n', 't', 's', '#', '-', '0'),
        minLength: 1,
        maxLength: 16,
      }),
    )
    .filter((owner) => owner !== AGENTCORE_HARNESS_GENERATOR_INFO.id),
  { nil: undefined },
);

/** Simple relative placement fragments (1-2 plain path segments). */
const arbPlacement = fc
  .array(
    fc.string({
      unit: fc.constantFrom('a', 'b', 'z', '0', '9', '_', '-'),
      minLength: 1,
      maxLength: 6,
    }),
    { minLength: 1, maxLength: 2 },
  )
  .map((segments) => segments.join('/'));

const arbForeignOwnershipScenario: fc.Arbitrary<ForeignOwnershipScenario> =
  fc.record({
    kind: fc.constant('foreignOwnership' as const),
    owner: arbForeignOwner,
    creation: arbCreationOptions,
  });

const arbIncompatibleRootScenario: fc.Arbitrary<IncompatibleRootScenario> =
  fc.record({
    kind: fc.constant('incompatibleRoot' as const),
    existingRootSeed: arbPlacement,
    directory: fc.option(arbPlacement, { nil: undefined }),
    subDirectory: fc.option(arbPlacement, { nil: undefined }),
  });

const arbReservedTargetScenario: fc.Arbitrary<ReservedTargetScenario> =
  fc.record({
    kind: fc.constant('incompatibleReservedTarget' as const),
    target: fc.constantFrom<ReservedTarget>('invoke', 'build'),
    corruption: fc.constantFrom<TargetCorruption>(
      'command',
      'executor',
      'extraOption',
      'emptyTarget',
    ),
    commandSuffix: fc.string({ maxLength: 12 }),
    creation: arbCreationOptions,
  });

const arbOptionVsPersistedScenario: fc.Arbitrary<OptionVsPersistedScenario> =
  fc.record({
    kind: fc.constant('explicitOptionVsPersisted' as const),
    option: fc.constantFrom<PersistedOption>(
      'modelId',
      'systemPrompt',
      'allowedTools',
      'maxIterations',
      'maxTokens',
      'timeoutSeconds',
    ),
    supplyInitial: fc.boolean(),
    initialText: arbFreeText,
    initialTools: arbTools,
    initialLimit: arbLimit,
    conflictText: arbFreeText,
    conflictTools: arbTools,
    conflictLimit: arbLimit,
  });

const arbProviderMismatchScenario: fc.Arbitrary<ProviderMismatchScenario> =
  fc.record({
    kind: fc.constant('explicitProviderMismatch' as const),
    existingProvider: fc.constantFrom<Provider>('cdk', 'terraform'),
    explicitInfra: fc.boolean(),
  });

const arbConflictCase = fc.record({
  name: arbValidName,
  scenario: fc.oneof(
    arbForeignOwnershipScenario,
    arbIncompatibleRootScenario,
    arbReservedTargetScenario,
    arbOptionVsPersistedScenario,
    arbProviderMismatchScenario,
  ),
});

// ---------------------------------------------------------------------------
// Scenario setup
// ---------------------------------------------------------------------------

/** Corrupt a reserved target so it differs from the Generator contract. */
const corruptReservedTarget = (
  contract: TargetConfiguration,
  corruption: TargetCorruption,
  commandSuffix: string,
): TargetConfiguration => {
  switch (corruption) {
    case 'command':
      // 'echo conflict …' can never equal a contract command.
      return {
        ...contract,
        options: {
          ...contract.options,
          command: `echo conflict ${commandSuffix}`,
        },
      };
    case 'executor':
      return { ...contract, executor: '@user/conflicting:executor' };
    case 'extraOption':
      return {
        ...contract,
        options: { ...contract.options, userExtra: 'conflict' },
      };
    case 'emptyTarget':
      return {};
  }
};

interface PreparedConflict {
  /** Schema-valid options whose run must fail with the conflict. */
  failingOptions: AgentcoreHarnessGeneratorSchema;
  /**
   * Substrings the diagnostic must contain to identify the conflicting
   * integration surface: the owning generator/project, both roots, the
   * reserved target name, the option name and both values, or both
   * provider names.
   */
  expectedSubstrings: string[];
}

/**
 * Establish the conflicting workspace precondition for one scenario and
 * return the failing options plus the surface-identification expectations.
 */
const prepareConflict = async (
  tree: Tree,
  name: string,
  scenario: ConflictScenario,
): Promise<PreparedConflict> => {
  switch (scenario.kind) {
    case 'foreignOwnership': {
      // A project already occupies the resolved name/root but is owned by a
      // different generator (or carries no generator metadata).
      const resolved = resolveAgentcoreHarnessOptions(tree, { name });
      addProjectConfiguration(tree, resolved.fullyQualifiedProjectName, {
        root: resolved.projectRoot,
        projectType: 'application',
        targets: {},
        ...(scenario.owner === undefined
          ? {}
          : { metadata: { generator: scenario.owner } as any }),
      });
      return {
        failingOptions: { name, infra: 'none', ...scenario.creation },
        expectedSubstrings: [
          `project '${resolved.fullyQualifiedProjectName}'`,
          scenario.owner !== undefined && scenario.owner.length > 0
            ? `the '${scenario.owner}' generator`
            : 'another tool (it has no generator metadata)',
        ],
      };
    }
    case 'incompatibleRoot': {
      // A Generator-owned project exists under the resolved name but at a
      // root different from the resolved placement.
      const resolved = resolveAgentcoreHarnessOptions(tree, {
        name,
        directory: scenario.directory,
        subDirectory: scenario.subDirectory,
      });
      const existingRoot =
        scenario.existingRootSeed === resolved.projectRoot
          ? `${scenario.existingRootSeed}-other`
          : scenario.existingRootSeed;
      addProjectConfiguration(tree, resolved.fullyQualifiedProjectName, {
        root: existingRoot,
        projectType: 'application',
        targets: {},
        metadata: { generator: AGENTCORE_HARNESS_GENERATOR_INFO.id } as any,
      });
      return {
        failingOptions: {
          name,
          directory: scenario.directory,
          subDirectory: scenario.subDirectory,
          infra: 'none',
        },
        // The diagnostic names both the existing and the resolved root.
        expectedSubstrings: [`'${existingRoot}'`, `'${resolved.projectRoot}'`],
      };
    }
    case 'incompatibleReservedTarget': {
      // Create the Harness Project, then corrupt one reserved target so a
      // rerun collides with the Generator target contract.
      await agentcoreHarnessGenerator(tree, {
        name,
        infra: 'none',
        ...scenario.creation,
      });
      const resolved = resolveAgentcoreHarnessOptions(tree, { name });
      const project = readProjectConfiguration(
        tree,
        resolved.fullyQualifiedProjectName,
      );
      project.targets![scenario.target] = corruptReservedTarget(
        project.targets![scenario.target],
        scenario.corruption,
        scenario.commandSuffix,
      );
      updateProjectConfiguration(
        tree,
        resolved.fullyQualifiedProjectName,
        project,
      );
      return {
        failingOptions: { name, infra: 'none' },
        expectedSubstrings: [`reserved '${scenario.target}' target`],
      };
    }
    case 'explicitOptionVsPersisted': {
      // Create the Harness Project (persisting creation defaults), then
      // rerun with an explicitly different value for one persisted option.
      const isLimit = LIMIT_OPTIONS.includes(scenario.option);
      const initialValue: string | string[] | number | undefined = isLimit
        ? // Omitted limits are never persisted, so a limit conflict requires
          // an explicit creation-time value.
          scenario.initialLimit
        : scenario.supplyInitial
          ? scenario.option === 'allowedTools'
            ? scenario.initialTools
            : scenario.initialText
          : undefined;
      const persisted = initialValue ?? PERSISTED_DEFAULTS[scenario.option];
      let conflicting: string | string[] | number =
        scenario.option === 'allowedTools'
          ? scenario.conflictTools
          : isLimit
            ? scenario.conflictLimit
            : scenario.conflictText;
      // Guarantee the rerun value differs from the persisted value.
      if (JSON.stringify(conflicting) === JSON.stringify(persisted)) {
        conflicting =
          scenario.option === 'allowedTools'
            ? [...scenario.conflictTools, 'made-different']
            : isLimit
              ? scenario.conflictLimit + 1
              : `${scenario.conflictText} (made different)`;
      }

      await agentcoreHarnessGenerator(tree, {
        name,
        infra: 'none',
        ...(initialValue !== undefined
          ? { [scenario.option]: initialValue }
          : {}),
      } as AgentcoreHarnessGeneratorSchema);

      return {
        failingOptions: {
          name,
          infra: 'none',
          [scenario.option]: conflicting,
        } as AgentcoreHarnessGeneratorSchema,
        // The diagnostic names the option and both values.
        expectedSubstrings: [
          `option '${scenario.option}'`,
          JSON.stringify(conflicting),
          JSON.stringify(persisted),
        ],
      };
    }
    case 'explicitProviderMismatch': {
      // The other provider's Shared Infrastructure Project already exists;
      // an explicit selection of the opposite provider is a mismatch.
      await sharedConstructsGenerator(tree, {
        iac: scenario.existingProvider,
      });
      const selected: Provider =
        scenario.existingProvider === 'cdk' ? 'terraform' : 'cdk';
      return {
        failingOptions: {
          name,
          iac: selected,
          ...(scenario.explicitInfra ? { infra: 'agentcore' as const } : {}),
        },
        // The diagnostic names both providers (4.9).
        expectedSubstrings: [`'${selected}'`, `'${scenario.existingProvider}'`],
      };
    }
  }
};

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

describe('agentcore-harness integration conflicts (Property 17)', () => {
  const snapshotChanges = (tree: Tree) =>
    tree
      .listChanges()
      .map(({ path, type, content }) => ({
        path,
        type,
        content: content?.toString('utf-8') ?? null,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));

  // Feature: agentcore-harness-generator, Property 17: Integration conflicts are classified and fail before tree mutation
  // **Validates: Requirements 4.9, 10.8, 10.10, 11.9**
  it('classifies every integration conflict, identifies the conflicting surface, and leaves the tree byte-for-byte unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(arbConflictCase, async ({ name, scenario }) => {
        // A fresh workspace per case: each scenario installs its own
        // conflicting precondition, so trees cannot be shared.
        const tree = createTreeUsingTsSolutionSetup();
        const { failingOptions, expectedSubstrings } = await prepareConflict(
          tree,
          name,
          scenario,
        );

        // Snapshot the complete change set after conflict setup and before
        // the failing run.
        const changesBefore = snapshotChanges(tree);

        let thrown: unknown;
        try {
          await agentcoreHarnessGenerator(tree, failingOptions);
        } catch (error) {
          thrown = error;
        }

        // Generation failed (10.8, 10.10, 4.9).
        expect(thrown).toBeInstanceOf(Error);
        const message = (thrown as Error).message;

        // Classified as an integration conflict (11.9) …
        expect(message).toMatch(INTEGRATION_CONFLICT_PREFIX);
        // … and not labeled as a schema-validation error (11.9). Schema
        // validation accepted every generated option, so no conflict kind
        // may blame option syntax.
        expect(message).not.toContain(SCHEMA_ERROR_LABEL);

        // The diagnostic identifies the conflicting integration surface:
        // owning generator/project, both roots, the reserved target name,
        // the option name with both values, or both provider names (4.9).
        for (const substring of expectedSubstrings) {
          expect(message).toContain(substring);
        }

        // The failing run mutated nothing: the tree change set is exactly
        // the post-setup snapshot (fail before tree mutation).
        expect(snapshotChanges(tree)).toEqual(changesBefore);
      }),
      // At least 100 runs required; 120 mixed runs give roughly 24 cases
      // per conflict kind while keeping the two-generator-run kinds within
      // the suite's runtime budget.
      { numRuns: 120 },
    );
  });
});
