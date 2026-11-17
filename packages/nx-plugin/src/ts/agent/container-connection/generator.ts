/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  generateFiles,
  joinPathFragments,
  logger,
  OverwriteStrategy,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import {
  assertContainerConnectionConstraints,
  containerServiceNames,
  resolveContainerComponent,
} from '../../../connection/container-connection.js';
import { addTsDependencies } from '../../../utils/add-dependencies.js';
import {
  AGENT_CONNECTION_DEPENDENCIES,
  AGENT_CONNECTION_PROJECT_DIR,
  ensureTypeScriptAgentConnectionProject,
} from '../../../utils/agent-connection/agent-connection.js';
import { addStarExport } from '../../../utils/ast.js';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { installDependencies } from '../../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics.js';
import { esmVars } from '../../../utils/module-format.js';
import { toClassName } from '../../../utils/names.js';
import {
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx.js';
import { assertSupportedNxVersion } from '../../../utils/nx-version.js';
import type { TsAgentContainerConnectionGeneratorSchema } from './schema';
import { agentContainerWiringMessage } from './wiring.js';

// The vended client reads the service URL from AppConfig and signs with SigV4,
// whatever the connection's options.
export const DEPENDENCIES = declareDependencies()({
  ts: [
    { name: '@aws-lambda-powertools/parameters' },
    { name: '@aws-sdk/credential-providers' },
    { name: 'aws4fetch' },
    ...ownedElsewhere(AGENT_CONNECTION_DEPENDENCIES),
  ],
});

export const TS_AGENT_CONTAINER_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Connect a TypeScript agent to a ts#container or py#container service.
 */
export const tsAgentContainerConnectionGenerator = async (
  tree: Tree,
  options: TsAgentContainerConnectionGeneratorSchema,
): Promise<GeneratorCallback> => {
  // Refuse an older Nx major before any file is written.
  assertSupportedNxVersion(tree);
  const agentProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const serviceProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );
  const component = resolveContainerComponent(
    serviceProject,
    options.targetComponent,
    'target',
  );
  const names = containerServiceNames(serviceProject, component);
  const agentName = options.sourceComponent?.name ?? 'agent';
  const agentClassName = options.sourceComponent?.rc ?? toClassName(agentName);

  assertContainerConnectionConstraints(
    `ts#agent -> ${component.generator}`,
    { target: component },
    {
      source: `${agentProject.name} (${agentName})`,
      target: `${serviceProject.name} (${names.prefix})`,
    },
  );

  await ensureTypeScriptAgentConnectionProject(tree, DEPENDENCIES);

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'agent-connection', 'app'),
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'app'),
    {
      nameClassName: names.nameClassName,
      nameKebabCase: names.nameKebabCase,
      port: names.port,
      ...esmVars(tree),
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  await addStarExport(
    tree,
    joinPathFragments(AGENT_CONNECTION_PROJECT_DIR, 'src', 'index.ts'),
    `./app/${names.nameKebabCase}-client.js`,
  );

  addTsDependencies(tree, DEPENDENCIES, {
    projectRoot: AGENT_CONNECTION_PROJECT_DIR,
  });

  const devTarget = `${agentName}-dev`;
  if (agentProject.targets?.[devTarget]) {
    addDependencyToTargetIfNotPresent(agentProject, devTarget, {
      projects: [serviceProject.name],
      target: `${names.prefix}-serve`,
    });
    updateProjectConfiguration(tree, agentProject.name, agentProject);
  }

  // Recorded so the version sync knows this connection's dependencies are ours.
  addComponentGeneratorMetadata(
    tree,
    agentProject.name,
    TS_AGENT_CONTAINER_CONNECTION_GENERATOR_INFO,
    names.sourceDir,
    `${agentName}-${names.nameClassName}`,
    // The source component this connection is made from, so the pair is
    // identifiable rather than just the two projects.
    { sourcePath: options.sourceComponent?.path },
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_AGENT_CONTAINER_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);

  const message = agentContainerWiringMessage({
    ...names,
    agentClassName,
  });
  return async () => {
    await installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
    logger.info(message);
  };
};

export default tsAgentContainerConnectionGenerator;
