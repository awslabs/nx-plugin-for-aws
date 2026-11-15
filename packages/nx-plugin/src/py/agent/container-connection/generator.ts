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
import { agentContainerWiringMessage } from '../../../ts/agent/container-connection/wiring.js';
import {
  assertContainerConnectionConstraints,
  containerServiceNames,
  resolveContainerComponent,
} from '../../../ts/container/react-connection/container-connection.js';
import { addPyDependencies } from '../../../utils/add-dependencies.js';
import {
  AGENT_CONNECTION_PY_DEPENDENCIES,
  addPythonReExport,
  ensurePythonAgentConnectionProject,
  getPythonAgentConnectionModuleName,
  getPythonAgentConnectionProject,
  getPythonAgentConnectionProjectDir,
} from '../../../utils/agent-connection/agent-connection.js';
import {
  declareDependencies,
  ownedElsewhere,
} from '../../../utils/declared-dependencies.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { installDependencies } from '../../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics.js';
import { toClassName } from '../../../utils/names.js';
import {
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx.js';
import { assertSupportedNxVersion } from '../../../utils/nx-version.js';
import { addWorkspaceDependencyToPyProject } from '../../../utils/py.js';
import type { PyAgentContainerConnectionGeneratorSchema } from './schema';

// The vended client reads the service URL from AppConfig and signs with SigV4
// through botocore, whatever the connection's options.
export const DEPENDENCIES = declareDependencies()({
  py: [
    { name: 'boto3' },
    { name: 'httpx' },
    ...ownedElsewhere(AGENT_CONNECTION_PY_DEPENDENCIES),
  ],
});

export const PY_AGENT_CONTAINER_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Connect a Python agent to a ts#container or py#container service.
 */
export const pyAgentContainerConnectionGenerator = async (
  tree: Tree,
  options: PyAgentContainerConnectionGeneratorSchema,
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
    `py#agent -> ${component.generator}`,
    { target: component },
    {
      source: `${agentProject.name} (${agentName})`,
      target: `${serviceProject.name} (${names.prefix})`,
    },
  );

  await ensurePythonAgentConnectionProject(tree, DEPENDENCIES);
  const agentConnectionProjectDir = getPythonAgentConnectionProjectDir(tree);
  const moduleDir = joinPathFragments(
    agentConnectionProjectDir,
    getPythonAgentConnectionModuleName(tree),
  );

  addPyDependencies(tree, DEPENDENCIES, {
    projectRoot: agentConnectionProjectDir,
  });

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'agent-connection', 'app'),
    joinPathFragments(moduleDir, 'app'),
    {
      nameClassName: names.nameClassName,
      nameSnakeCase: names.moduleName,
      port: names.port,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
  await addPythonReExport(
    tree,
    joinPathFragments(moduleDir, '__init__.py'),
    `.app.${names.moduleName}_client`,
    `get_${names.moduleName}_client`,
  );

  addWorkspaceDependencyToPyProject(
    tree,
    agentProject,
    getPythonAgentConnectionProject(tree),
  );

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
    PY_AGENT_CONTAINER_CONNECTION_GENERATOR_INFO,
    names.sourceDir,
    `${agentName}-${names.nameClassName}`,
    // The source component this connection is made from, so the pair is
    // identifiable rather than just the two projects.
    { sourcePath: options.sourceComponent?.path },
  );

  await addGeneratorMetricsIfApplicable(tree, [
    PY_AGENT_CONTAINER_CONNECTION_GENERATOR_INFO,
  ]);

  await formatFilesInSubtree(tree);

  const message = agentContainerWiringMessage({ ...names, agentClassName });
  return async () => {
    await installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
    logger.info(message);
  };
};

export default pyAgentContainerConnectionGenerator;
