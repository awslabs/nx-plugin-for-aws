/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  joinPathFragments,
  logger,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import {
  assertContainerConnectionConstraints,
  containerServiceNames,
  resolveContainerComponent,
} from '../../../connection/container-connection.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { installDependencies } from '../../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics.js';
import {
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx.js';
import { assertSupportedNxVersion } from '../../../utils/nx-version.js';
import { addWorkspaceDependencyToPyProject } from '../../../utils/py.js';
import { injectRdsCaBundleIntoDockerfile } from '../utils.js';
import type { PyRdbContainerConnectionGeneratorSchema } from './schema';
import { dataStoreNames, rdbContainerWiringMessage } from './wiring.js';

export const PY_RDB_CONTAINER_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Connect a py#container service to a py#rdb project.
 */
export const pyRdbContainerConnectionGenerator = async (
  tree: Tree,
  options: PyRdbContainerConnectionGeneratorSchema,
): Promise<GeneratorCallback> => {
  // Refuse an older Nx major before any file is written.
  assertSupportedNxVersion(tree);
  const serviceProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );
  const component = resolveContainerComponent(
    serviceProject,
    options.sourceComponent,
    'source',
  );
  const names = containerServiceNames(serviceProject, component);

  assertContainerConnectionConstraints(
    `${component.generator} -> py#rdb`,
    { source: component },
    {
      source: `${serviceProject.name} (${names.prefix})`,
      target: targetProject.name,
    },
  );

  addWorkspaceDependencyToPyProject(tree, serviceProject, targetProject);

  // Dockerfile: install RDS CA bundle for direct Aurora SSL connections
  injectRdsCaBundleIntoDockerfile(
    tree,
    joinPathFragments(names.sourceDir, 'Dockerfile'),
  );

  const serveTarget = `${names.prefix}-serve`;
  if (serviceProject.targets?.[serveTarget]) {
    addDependencyToTargetIfNotPresent(serviceProject, serveTarget, {
      projects: [targetProject.name],
      target: 'dev',
    });
    updateProjectConfiguration(tree, serviceProject.name, serviceProject);
  }

  // Recorded so the version sync can identify this connection.
  addComponentGeneratorMetadata(
    tree,
    serviceProject.name,
    PY_RDB_CONTAINER_CONNECTION_GENERATOR_INFO,
    targetProject.root,
    `${names.prefix}-${targetProject.name}`,
    // The source component this connection is made from, so the pair is
    // identifiable rather than just the two projects.
    { sourcePath: options.sourceComponent?.path },
  );

  await addGeneratorMetricsIfApplicable(tree, [
    PY_RDB_CONTAINER_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);

  const message = rdbContainerWiringMessage(
    names,
    dataStoreNames(targetProject.name),
  );
  return async () => {
    await installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
    logger.info(message);
  };
};

export default pyRdbContainerConnectionGenerator;
