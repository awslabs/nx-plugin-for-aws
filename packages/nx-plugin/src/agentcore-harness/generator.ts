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
import { addTsDependencies } from '../utils/add-dependencies';
import { addAgentCoreHarnessInfra } from '../utils/agent-core-constructs/agent-core-constructs';
import {
  declareDependencies,
  ownedElsewhere,
} from '../utils/declared-dependencies';
import { formatFilesInSubtree } from '../utils/format';
import { resolveIac } from '../utils/iac';
import { installDependencies } from '../utils/install';
import { addGeneratorMetricsIfApplicable } from '../utils/metrics';
import { kebabCase, toClassName } from '../utils/names';
import { getNpmScopePrefix } from '../utils/npm-scope';
import {
  addGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  projectExists,
  readProjectConfigurationUnqualified,
} from '../utils/nx';
import {
  SHARED_CONSTRUCTS_DEPENDENCIES,
  sharedConstructsGenerator,
} from '../utils/shared-constructs';
import type { IacMetadata } from '../utils/shared-constructs-constants';
import type { AgentcoreHarnessGeneratorSchema } from './schema';

// scripts/chat.ts needs all of these whatever the infrastructure choice, so no
// entry is conditional. The harness project holds no manifest of its own, so
// every entry is declared against the workspace root.
export const DEPENDENCIES = declareDependencies<AgentCoreHarnessMetadata>()({
  ts: [
    { name: '@aws-sdk/client-bedrock-agentcore', root: true },
    { name: '@aws-sdk/client-appconfigdata', root: true },
    { name: '@aws-lambda-powertools/parameters', root: true },
    { name: 'agent-chat-cli', root: true },
    // tsx runs the chat script via the `chat` target; both are shared tooling.
    { name: '@types/node', dev: true, root: true },
    { name: 'tsx', dev: true, root: true },
    ...ownedElsewhere(SHARED_CONSTRUCTS_DEPENDENCIES),
  ],
});

export const AGENTCORE_HARNESS_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

export const agentcoreHarnessGenerator = async (
  tree: Tree,
  options: AgentcoreHarnessGeneratorSchema,
): Promise<GeneratorCallback> => {
  const nameKebabCase = kebabCase(options.name);
  const nameClassName = toClassName(nameKebabCase);
  const parentDir = options.directory ?? 'packages';
  const subDir = options.subDirectory ?? nameKebabCase;
  const projectRoot = joinPathFragments(parentDir, subDir);
  const fullyQualifiedProjectName = `${getNpmScopePrefix(tree)}${nameKebabCase}`;
  const infra = options.infra ?? 'agentcore';

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

  // Resolved before the metadata write because the recorded value is what the
  // declaration's predicates read; undefined when no infrastructure is written,
  // in which case neither provider's packages were added.
  const iac =
    infra === 'agentcore' ? await resolveIac(tree, options.iac) : undefined;

  // Record only what cannot drift once the user owns the generated
  // infrastructure: the project identity, its runtime config key, its auth mode
  // and which provider's infrastructure was written.
  const metadata: Omit<AgentCoreHarnessMetadata, 'generator'> = {
    name: nameKebabCase,
    rc: nameClassName,
    auth: 'iam',
    ...(iac ? { iac } : {}),
  };

  addGeneratorMetadata(
    tree,
    fullyQualifiedProjectName,
    AGENTCORE_HARNESS_GENERATOR_INFO,
    metadata,
  );

  // scripts/chat.ts dependencies; tsx runs it via the `chat` target.
  addTsDependencies(tree, DEPENDENCIES, { metadata });

  // Harness infrastructure is written only for `infra: agentcore`. A later
  // `infra: agentcore` rerun adds it without replacing project files.
  if (iac) {
    await sharedConstructsGenerator(tree, { iac }, DEPENDENCIES);
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
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

/**
 * Harness details stored in the Harness Project's metadata. `iac` records which
 * provider's infrastructure was written, so the version sync can tell which
 * shared constructs packages this project owns.
 */
export interface AgentCoreHarnessMetadata extends IacMetadata {
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
