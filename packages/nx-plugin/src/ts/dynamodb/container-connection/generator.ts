/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  logger,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics.js';
import {
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx.js';
import { assertSupportedNxVersion } from '../../../utils/nx-version.js';
import {
  assertContainerConnectionConstraints,
  containerServiceNames,
  resolveContainerComponent,
} from '../../container/react-connection/container-connection.js';
import type { TsDynamoDBContainerConnectionGeneratorSchema } from './schema';
import { dataStoreNames, dynamoDBContainerWiringMessage } from './wiring.js';

export const TS_DYNAMODB_CONTAINER_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Connect a ts#container service to a ts#dynamodb project.
 */
export const tsDynamoDBContainerConnectionGenerator = async (
  tree: Tree,
  options: TsDynamoDBContainerConnectionGeneratorSchema,
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
    `${component.generator} -> ts#dynamodb`,
    { source: component },
    {
      source: `${serviceProject.name} (${names.prefix})`,
      target: targetProject.name,
    },
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
    TS_DYNAMODB_CONTAINER_CONNECTION_GENERATOR_INFO,
    targetProject.root,
    `${names.prefix}-${targetProject.name}`,
    // The source component this connection is made from, so the pair is
    // identifiable rather than just the two projects.
    { sourcePath: options.sourceComponent?.path },
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_DYNAMODB_CONTAINER_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);

  // Printed from the callback so it appears after Nx lists the changed files.
  const message = dynamoDBContainerWiringMessage(
    names,
    dataStoreNames(targetProject.name),
  );
  return () => {
    logger.info(message);
  };
};

export default tsDynamoDBContainerConnectionGenerator;
