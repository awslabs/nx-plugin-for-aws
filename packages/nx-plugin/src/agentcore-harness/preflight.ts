/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type ProjectConfiguration,
  type TargetConfiguration,
  type Tree,
} from '@nx/devkit';
import type { Iac } from '../utils/iac';
import {
  projectExists,
  readProjectConfigurationUnqualified,
} from '../utils/nx';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../utils/shared-constructs-constants';
import type { ResolvedAgentcoreHarnessOptions } from './resolve-options';
import type { AgentcoreHarnessGeneratorSchema } from './schema';

/**
 * The reserved Nx target contract owned by the agentcore-harness generator.
 *
 * Preflight compares an existing reserved target against these exact shapes
 * with deep equality: an identical target is compatible and later retained
 * byte-for-byte, while any difference is a target-conflict that fails before
 * mutation. The `build` target is wired during project generation, but the
 * preflight contract knows both reserved targets so either collision is
 * rejected up front.
 */
export const AGENTCORE_HARNESS_RESERVED_TARGETS = {
  invoke: {
    executor: 'nx:run-commands',
    options: {
      command: 'tsx invoke.ts',
      cwd: '{projectRoot}',
    },
  },
  build: {
    executor: 'nx:run-commands',
    options: {
      command: 'tsc --noEmit --project tsconfig.json',
      cwd: '{projectRoot}',
    },
  },
} as const satisfies Record<string, TargetConfiguration>;

/**
 * Creation options that are persisted in Generator-owned project metadata
 * (schema option names and metadata field names align one-to-one). On a
 * rerun the persisted value is authoritative when the option is omitted,
 * and an explicitly supplied different value is an integration conflict:
 * generated files are user-owned after creation and are never rewritten,
 * so silently accepting a new value would imply templates were updated.
 */
const PERSISTED_CREATION_OPTIONS = [
  'modelId',
  'systemPrompt',
  'allowedTools',
  'maxIterations',
  'maxTokens',
  'timeoutSeconds',
] as const;

/**
 * Structure-insensitive deep equality for plain JSON-like values (target
 * configurations, metadata values). Key order does not matter; array order
 * does.
 */
const deepEquals = (a: unknown, b: unknown): boolean => {
  if (a === b) {
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, i) => deepEquals(item, b[i]))
    );
  }
  if (
    typeof a === 'object' &&
    a !== null &&
    typeof b === 'object' &&
    b !== null
  ) {
    const aEntries = Object.entries(a as Record<string, unknown>);
    const bRecord = b as Record<string, unknown>;
    return (
      aEntries.length === Object.keys(bRecord).length &&
      aEntries.every(
        ([key, value]) =>
          Object.hasOwn(bRecord, key) && deepEquals(value, bRecord[key]),
      )
    );
  }
  return false;
};

/**
 * A project-level integration conflict detected after schema validation
 * accepted every supplied option. Deliberately not phrased as a
 * schema-validation error (`Invalid option ...`) so diagnostics identify
 * the conflicting integration surface instead of blaming option syntax.
 */
const integrationConflict = (message: string): Error =>
  new Error(`Integration conflict: ${message}`);

/** Result of a successful project preflight. */
export interface AgentcoreHarnessPreflightResult {
  /**
   * The existing Generator-owned project configuration when the resolved
   * project already exists; undefined when generation will create it.
   */
  existingProject?: ProjectConfiguration;
  /**
   * Effective resolved options. On a compatible rerun, persisted
   * Generator-owned metadata is authoritative for omitted creation options
   * so reruns are deterministic and never drift from generated templates.
   */
  options: ResolvedAgentcoreHarnessOptions;
}

/**
 * Inspect the workspace for project-level integration conflicts before any
 * tree mutation.
 *
 * Rejects, in order:
 * 1. An existing project at the resolved fully-qualified name owned by a
 *    different generator (or lacking generator metadata).
 * 2. An existing project whose root differs from the resolved project root.
 * 3. An existing reserved `invoke`/`build` target that differs from the
 *    Generator's target contract (identical targets are compatible).
 * 4. An explicitly supplied creation option that conflicts with the value
 *    persisted in Generator-owned metadata when the project was created.
 *
 * Every rejection throws before the generator mutates the Nx tree, so a
 * conflicting workspace is left byte-for-byte unchanged.
 */
export const preflightAgentcoreHarnessProject = (
  tree: Tree,
  generatorId: string,
  rawOptions: AgentcoreHarnessGeneratorSchema,
  resolved: ResolvedAgentcoreHarnessOptions,
): AgentcoreHarnessPreflightResult => {
  if (!projectExists(tree, resolved.fullyQualifiedProjectName)) {
    return { options: resolved };
  }

  const project = readProjectConfigurationUnqualified(
    tree,
    resolved.fullyQualifiedProjectName,
  );
  const metadata = (project.metadata ?? {}) as Record<string, unknown>;

  const owner = metadata.generator;
  if (owner !== generatorId) {
    throw integrationConflict(
      `project '${project.name}' already exists but is owned by ${
        typeof owner === 'string' && owner.length > 0
          ? `the '${owner}' generator`
          : 'another tool (it has no generator metadata)'
      }, so the '${generatorId}' generator cannot adopt it. Choose a different name or remove the conflicting project.`,
    );
  }

  if (project.root !== resolved.projectRoot) {
    throw integrationConflict(
      `project '${project.name}' already exists at '${project.root}', which is incompatible with the resolved project root '${resolved.projectRoot}'. Supply directory/subDirectory options matching the existing location, or choose a different name.`,
    );
  }

  for (const [targetName, contract] of Object.entries(
    AGENTCORE_HARNESS_RESERVED_TARGETS,
  )) {
    const existing = project.targets?.[targetName];
    if (existing !== undefined && !deepEquals(existing, contract)) {
      throw integrationConflict(
        `project '${project.name}' defines a reserved '${targetName}' target that differs from the agentcore-harness target contract. Rename or remove the conflicting target, then rerun the generator.`,
      );
    }
  }

  const persistedOverrides: Record<string, unknown> = {};
  for (const option of PERSISTED_CREATION_OPTIONS) {
    const persisted = metadata[option];
    if (persisted === undefined) {
      // Not persisted yet (e.g. metadata written before this field was
      // owned); the resolved value stands and the missing owned field is
      // filled deterministically by the metadata merge stage.
      continue;
    }
    const explicit = rawOptions[option];
    if (explicit !== undefined) {
      if (!deepEquals(explicit, persisted)) {
        throw integrationConflict(
          `option '${option}' (${JSON.stringify(explicit)}) conflicts with the value persisted when project '${project.name}' was created (${JSON.stringify(persisted)}). Generated files are user-owned after creation and are not rewritten, so the new value would not be applied. Omit '${option}' to keep the persisted configuration, or edit the generated files directly.`,
        );
      }
    } else {
      // Persisted Generator-owned metadata is authoritative for omitted
      // options on reruns. Copy arrays so callers cannot alias metadata.
      persistedOverrides[option] = Array.isArray(persisted)
        ? [...persisted]
        : persisted;
    }
  }

  return {
    existingProject: project,
    options: {
      ...resolved,
      // Metadata is plain JSON persisted by this generator; the persisted
      // field types match the resolved option types by construction.
      ...(persistedOverrides as Partial<ResolvedAgentcoreHarnessOptions>),
    },
  };
};

/**
 * Root directory of each provider's Shared Infrastructure Project. A
 * provider's project exists exactly when its `project.json` exists — the
 * same check `sharedConstructsGenerator` uses to decide whether it would
 * create that project.
 */
const SHARED_INFRA_PROJECT_DIRS: Record<Iac, string> = {
  cdk: joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR),
  terraform: joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR),
};

const sharedInfraProjectExists = (tree: Tree, provider: Iac): boolean =>
  tree.exists(
    joinPathFragments(SHARED_INFRA_PROJECT_DIRS[provider], 'project.json'),
  );

/**
 * Inspect the workspace for a provider-compatibility conflict between an
 * explicitly selected IaC provider and an existing Shared Infrastructure
 * Project, before any tree mutation.
 *
 * Applies only when Harness infrastructure is requested (`infra:
 * agentcore`) with an explicit `cdk` or `terraform` selection: `inherit`
 * resolves through the repository's existing inheritance behaviour and is
 * never a mismatch. A mismatch exists when the other provider's Shared
 * Infrastructure Project is present and the selected provider's is not —
 * generating would introduce a second, conflicting provider into the
 * workspace. When the selected provider's project already exists,
 * generation composes with it and is compatible regardless of what else
 * exists.
 *
 * Throws a diagnostic naming both providers so a mismatched run terminates
 * with the entire Nx tree byte-for-byte unchanged.
 */
export const preflightAgentcoreHarnessIacProvider = (
  tree: Tree,
  resolved: Pick<ResolvedAgentcoreHarnessOptions, 'infra' | 'iac'>,
): void => {
  if (resolved.infra !== 'agentcore' || resolved.iac === 'inherit') {
    return;
  }
  const selected = resolved.iac;
  const existing: Iac = selected === 'cdk' ? 'terraform' : 'cdk';
  if (
    sharedInfraProjectExists(tree, selected) ||
    !sharedInfraProjectExists(tree, existing)
  ) {
    return;
  }
  throw integrationConflict(
    `the explicitly selected IaC provider '${selected}' differs from the existing '${existing}' Shared Infrastructure Project at '${SHARED_INFRA_PROJECT_DIRS[existing]}'. Rerun with --iac=${existing} to match the existing infrastructure, or omit --iac to inherit the workspace default.`,
  );
};
