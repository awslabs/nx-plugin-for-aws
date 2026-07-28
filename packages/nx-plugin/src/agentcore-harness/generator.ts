/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addProjectConfiguration,
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type ProjectConfiguration,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { addAgentCoreHarnessInfra } from '../utils/agent-core-constructs/agent-core-constructs';
import { addDependenciesToPackageJson } from '../utils/dependencies';
import { formatFilesInSubtree } from '../utils/format';
import { type Iac, type IacOption, resolveIac } from '../utils/iac';
import { installDependencies } from '../utils/install';
import { addGeneratorMetricsIfApplicable } from '../utils/metrics';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../utils/nx';
import { sharedConstructsGenerator } from '../utils/shared-constructs';
import { withVersions } from '../utils/versions';
import {
  AGENTCORE_HARNESS_RESERVED_TARGETS,
  preflightAgentcoreHarnessIacProvider,
  preflightAgentcoreHarnessProject,
} from './preflight';
import { resolveAgentcoreHarnessOptions } from './resolve-options';
import type { AgentcoreHarnessGeneratorSchema } from './schema';

export const AGENTCORE_HARNESS_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Resolve the IaC provider through the repository's existing inheritance
 * behaviour (`resolveIac`).
 *
 * Explicit `cdk`/`terraform` selections resolve to themselves and cannot
 * fail; only `inherit` resolution can throw (no workspace default
 * configured). The shared diagnostic explains the workspace-default fix,
 * so this wrapper adds the invocation-scoped remediation: how to select
 * `cdk` or `terraform` explicitly for this run.
 */
const resolveHarnessIac = async (
  tree: Tree,
  iacOption: IacOption,
): Promise<Iac> => {
  try {
    return await resolveIac(tree, iacOption);
  } catch (error) {
    throw new Error(
      `${
        error instanceof Error ? error.message : String(error)
      }. Alternatively, rerun the generator with an explicit provider: --iac=cdk or --iac=terraform.`,
    );
  }
};

export const agentcoreHarnessGenerator = async (
  tree: Tree,
  options: AgentcoreHarnessGeneratorSchema,
): Promise<GeneratorCallback> => {
  // Validate every schema predicate and resolve the exact creation defaults
  // before any tree mutation, so a rejected option terminates generation
  // without invoking infrastructure helpers.
  const preResolved = resolveAgentcoreHarnessOptions(tree, options);
  // Preflight the workspace before any tree mutation: reject foreign
  // generator ownership, an incompatible project root, incompatible
  // reserved `invoke`/`build` targets, and explicit creation options that
  // conflict with persisted Generator-owned metadata. On a compatible
  // rerun, persisted metadata is authoritative for omitted options.
  const preflight = preflightAgentcoreHarnessProject(
    tree,
    AGENTCORE_HARNESS_GENERATOR_INFO.id,
    options,
    preResolved,
  );
  const resolved = preflight.options;
  // Still before any tree mutation, compare an explicit `cdk`/`terraform`
  // selection with any existing Shared Infrastructure Project. A mismatch
  // terminates generation with a diagnostic naming both providers before
  // any project, template, dependency, metric, or formatting change, so no
  // output can be mistaken for a successful mismatched-provider run.
  preflightAgentcoreHarnessIacProvider(tree, resolved);
  const {
    nameKebabCase,
    nameClassName,
    fullyQualifiedProjectName,
    projectRoot,
    modelId,
    systemPrompt,
    allowedTools,
    infra,
  } = resolved;

  // Clone the reserved target contracts so project creation and preflight
  // stay in lockstep: preflight already guaranteed any existing reserved
  // target is identical, so `??=` below retains compatible targets
  // byte-for-byte and only adds a reserved target when absent, while
  // unrelated user-defined targets are never touched.
  const invokeTarget = structuredClone(
    AGENTCORE_HARNESS_RESERVED_TARGETS.invoke,
  );
  const buildTarget = structuredClone(AGENTCORE_HARNESS_RESERVED_TARGETS.build);

  let project: ProjectConfiguration;
  if (preflight.existingProject) {
    project = preflight.existingProject;
  } else {
    addProjectConfiguration(tree, fullyQualifiedProjectName, {
      name: fullyQualifiedProjectName,
      root: projectRoot,
      projectType: 'application',
      sourceRoot: projectRoot,
      tags: [],
      targets: {
        invoke: invokeTarget,
        build: buildTarget,
      },
      metadata: {
        generator: AGENTCORE_HARNESS_GENERATOR_INFO.id,
      } as any,
    });
    project = readProjectConfigurationUnqualified(
      tree,
      fullyQualifiedProjectName,
    );
  }

  project.targets ??= {};
  project.targets.invoke ??= invokeTarget;
  project.targets.build ??= buildTarget;
  updateProjectConfiguration(tree, project.name, project);

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'project'),
    projectRoot,
    {
      nameClassName,
      nameKebabCase,
      fullyQualifiedName: fullyQualifiedProjectName,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Persist the complete set of Harness creation defaults so reruns are
  // deterministic and an `infra: none` project can add infrastructure later
  // using the original configuration rather than guessing. Omitted execution
  // limits are not persisted: JSON cannot represent `undefined`, so key
  // absence consistently means "created without this limit" and reruns
  // cannot drift through serialization.
  const ownedMetadata: Omit<AgentCoreHarnessMetadata, 'generator'> = {
    name: nameKebabCase,
    rc: nameClassName,
    runtimeConfigPath: resolved.runtimeConfigPath,
    modelId,
    systemPrompt,
    allowedTools: [...allowedTools],
    ...(resolved.maxIterations !== undefined
      ? { maxIterations: resolved.maxIterations }
      : {}),
    ...(resolved.maxTokens !== undefined
      ? { maxTokens: resolved.maxTokens }
      : {}),
    ...(resolved.timeoutSeconds !== undefined
      ? { timeoutSeconds: resolved.timeoutSeconds }
      : {}),
    auth: resolved.auth,
  };
  // Fill only missing Generator-owned fields: existing owned fields are the
  // creation-time values (preflight already made them authoritative for
  // omitted options and rejected explicit conflicts, so for present fields
  // the resolved value equals the persisted value; filtering keeps even
  // hand-edited metadata intact). Unrelated metadata fields are preserved
  // by addGeneratorMetadata itself, and a rerun that fills nothing skips
  // the project.json write entirely.
  const existingMetadata = (project.metadata ?? {}) as Record<string, unknown>;
  addGeneratorMetadata(
    tree,
    fullyQualifiedProjectName,
    AGENTCORE_HARNESS_GENERATOR_INFO,
    Object.fromEntries(
      Object.entries(ownedMetadata).filter(
        ([field]) => existingMetadata[field] === undefined,
      ),
    ),
  );

  addDependenciesToPackageJson(
    tree,
    // Runtime dependencies imported by the generated Invocation Client
    // (invoke.ts) when it executes.
    withVersions([
      '@aws-sdk/client-bedrock-agentcore',
      '@aws-sdk/client-appconfigdata',
      '@aws-lambda-powertools/parameters',
    ]),
    // Development dependencies required by the generated targets: `tsx`
    // runs the `invoke` target, and the reserved `build` target type-checks
    // the Invocation Client with `tsc --noEmit`, so the generated workspace
    // needs the exact-pinned TypeScript compiler and Node type declarations.
    withVersions(['@types/node', 'tsx', 'typescript']),
  );

  // Harness infrastructure is written only for `infra: agentcore`. For
  // `infra: none` this entire block is skipped: no IaC provider is
  // resolved and no Shared Infrastructure Project is created, read, or
  // modified. A later `infra: agentcore` rerun takes the compatible-rerun
  // path above (KeepExisting templates, persisted creation defaults) and
  // adds the absent infrastructure here without replacing project files.
  if (infra === 'agentcore') {
    const iac = await resolveHarnessIac(tree, resolved.iac);
    // Ensure the Shared Infrastructure Project for the resolved provider
    // exists before adding Harness infrastructure. The provider preflight
    // above already rejected explicit selections that conflict with an
    // existing project, so only the selected provider's project is created
    // or reused here; a creation failure propagates as-is.
    await sharedConstructsGenerator(tree, { iac });
    await addAgentCoreHarnessInfra(tree, {
      harnessNameClassName: nameClassName,
      harnessNameKebabCase: nameKebabCase,
      modelId,
      systemPrompt,
      allowedTools: [...allowedTools],
      maxIterations: resolved.maxIterations,
      maxTokens: resolved.maxTokens,
      timeoutSeconds: resolved.timeoutSeconds,
      iac,
    });
  }

  await addGeneratorMetricsIfApplicable(tree, [
    AGENTCORE_HARNESS_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, resolved.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

/**
 * Harness details stored in the Harness Project's metadata.
 *
 * The persisted creation defaults are the authoritative rerun context:
 * omitted options resolve from these values on compatible reruns, and an
 * `infra: none` project can add infrastructure later without guessing the
 * original configuration. `generator` is managed by the shared metadata
 * utilities; execution-limit fields are present only when a limit was
 * supplied at creation.
 */
export interface AgentCoreHarnessMetadata {
  generator: string;
  name: string;
  rc: string;
  runtimeConfigPath: `agentcore.harnesses.${string}`;
  modelId: string;
  systemPrompt: string;
  allowedTools: string[];
  maxIterations?: number;
  maxTokens?: number;
  timeoutSeconds?: number;
  auth: 'iam';
}

/**
 * Read a Harness Project's metadata, validating it was generated by the
 * agentcore-harness generator before returning typed data.
 */
export const readAgentCoreHarnessMetadata = (
  project: ProjectConfiguration,
): AgentCoreHarnessMetadata => {
  const metadata = project.metadata as any;
  if (metadata?.generator !== AGENTCORE_HARNESS_GENERATOR_INFO.id) {
    throw new Error(
      `Project '${project.name}' was not generated by the '${AGENTCORE_HARNESS_GENERATOR_INFO.id}' generator.`,
    );
  }
  return metadata as AgentCoreHarnessMetadata;
};

export default agentcoreHarnessGenerator;
