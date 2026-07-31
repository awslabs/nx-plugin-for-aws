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
  projectExists,
  readProjectConfigurationUnqualified,
} from '../utils/nx';
import { sharedConstructsGenerator } from '../utils/shared-constructs';
import { withVersions } from '../utils/versions';
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
  const resolved = resolveAgentcoreHarnessOptions(tree, options);
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

  // Reuse an existing project configuration; create it otherwise.
  let project: ProjectConfiguration;
  if (projectExists(tree, fullyQualifiedProjectName)) {
    project = readProjectConfigurationUnqualified(
      tree,
      fullyQualifiedProjectName,
    );
  } else {
    addProjectConfiguration(tree, fullyQualifiedProjectName, {
      name: fullyQualifiedProjectName,
      root: projectRoot,
      projectType: 'application',
      sourceRoot: projectRoot,
      tags: [],
      targets: {},
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

  // Persist the Harness creation defaults so an `infra: none` project can
  // add infrastructure later. Omitted execution limits are absent rather
  // than `undefined`, which JSON cannot represent.
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
  // Fill only missing Generator-owned fields so hand-edited metadata stays
  // intact. addGeneratorMetadata preserves unrelated fields, and a rerun
  // that fills nothing skips the project.json write entirely.
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
    withVersions([
      '@aws-sdk/client-bedrock-agentcore',
      '@aws-sdk/client-appconfigdata',
      '@aws-lambda-powertools/parameters',
    ]),
    withVersions(['@types/node', 'tsx', 'typescript']),
  );

  // Harness infrastructure is written only for `infra: agentcore`; for
  // `infra: none` no IaC provider is resolved and no Shared Infrastructure
  // Project is touched. A later `infra: agentcore` rerun adds it here
  // without replacing project files.
  if (infra === 'agentcore') {
    const iac = await resolveHarnessIac(tree, resolved.iac);
    // Ensure the Shared Infrastructure Project for the resolved provider
    // exists before adding Harness infrastructure.
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
 * `generator` is managed by the shared metadata utilities; execution-limit
 * fields are present only when a limit was supplied at creation.
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
