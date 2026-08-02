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
import { resolveIac } from '../utils/iac';
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

export const agentcoreHarnessGenerator = async (
  tree: Tree,
  options: AgentcoreHarnessGeneratorSchema,
): Promise<GeneratorCallback> => {
  // Validate every schema predicate and resolve defaults before any tree
  // mutation, so a rejected option terminates generation without invoking
  // infrastructure helpers.
  const resolved = resolveAgentcoreHarnessOptions(tree, options);
  const {
    nameKebabCase,
    nameClassName,
    fullyQualifiedProjectName,
    projectRoot,
    infra,
  } = resolved;

  // AgentCore harness names must start with an ASCII letter and stay within 40
  // characters once the "_<8 hex>" suffix is appended, so cap the prefix at 31.
  // toClassName prefixes `_` (not a letter) for digit-leading names.
  const harnessNamePrefix = (
    /^[A-Za-z]/.test(nameClassName) ? nameClassName : `H${nameClassName}`
  ).slice(0, 31);

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

  // `chat` runs the vended chat script against the deployed Harness. Re-run:
  // keep an existing target so user edits survive.
  project.targets ??= {};
  project.targets['chat'] ??= {
    executor: 'nx:run-commands',
    options: {
      commands: ['tsx ./scripts/chat.ts'],
      cwd: '{projectRoot}',
    },
  };
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

  // Record only what cannot drift once the user owns the generated
  // infrastructure: the project identity, its runtime config key and auth mode.
  addGeneratorMetadata(
    tree,
    fullyQualifiedProjectName,
    AGENTCORE_HARNESS_GENERATOR_INFO,
    {
      name: nameKebabCase,
      rc: nameClassName,
      auth: resolved.auth,
    },
  );

  // scripts/chat.ts dependencies; tsx runs it via the `chat` target.
  addDependenciesToPackageJson(
    tree,
    withVersions([
      '@aws-sdk/client-bedrock-agentcore',
      '@aws-sdk/client-appconfigdata',
      '@aws-lambda-powertools/parameters',
      'agent-chat-cli',
    ]),
    withVersions(['@types/node', 'tsx']),
  );

  // Harness infrastructure is written only for `infra: agentcore`. A later
  // `infra: agentcore` rerun adds it without replacing project files.
  if (infra === 'agentcore') {
    const iac = await resolveIac(tree, resolved.iac);
    await sharedConstructsGenerator(tree, { iac });
    await addAgentCoreHarnessInfra(tree, {
      harnessNameClassName: nameClassName,
      harnessNameKebabCase: nameKebabCase,
      projectRoot,
      harnessNamePrefix,
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
 */
export interface AgentCoreHarnessMetadata {
  generator: string;
  name: string;
  rc: string;
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
