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
import { toProjectRelativePath } from '../../../utils/paths.js';
import { injectRdsCaBundleIntoDockerfile } from '../utils.js';
import type { TsRdbContainerConnectionGeneratorSchema } from './schema';
import { dataStoreNames, rdbContainerWiringMessage } from './wiring.js';

export const TS_RDB_CONTAINER_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

/**
 * Node reads its own bundled CA store, not the system store
 * `update-ca-certificates` writes, so the image points it at the RDS bundle.
 */
const NODE_CA_ENV =
  'ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/rds-bundle.crt';

/**
 * Adds the `ENV` that makes Node trust the bundle the shared injector
 * installs. Scoped to this generator: the sibling connections configure the
 * variable on their deployed function or task instead. Leaves the Dockerfile
 * alone when the install step is not where it was written, and adds the `ENV`
 * once, so a re-run changes nothing.
 */
const trustRdsCaBundleInNode = (tree: Tree, dockerfilePath: string): void => {
  if (!tree.exists(dockerfilePath)) return;
  const content = tree.read(dockerfilePath, 'utf-8')!;
  if (content.includes(NODE_CA_ENV)) return;
  tree.write(
    dockerfilePath,
    content.replace(/^([ \t]*update-ca-certificates)$/m, `$1\n${NODE_CA_ENV}`),
  );
};

/**
 * Connect a ts#container service to a ts#rdb project.
 */
export const tsRdbContainerConnectionGenerator = async (
  tree: Tree,
  options: TsRdbContainerConnectionGeneratorSchema,
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
    `${component.generator} -> ts#rdb`,
    { source: component },
    {
      source: `${serviceProject.name} (${names.prefix})`,
      target: targetProject.name,
    },
  );

  const db = dataStoreNames(targetProject.name);
  const getterPath = joinPathFragments(names.sourceDir, `${db.kebabCase}.ts`);

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files'),
    names.sourceDir,
    {
      rdbNameKebab: db.kebabCase,
      rdbNamePascal: db.className,
      rdbPackageAlias: targetProject.name,
    },
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  // Dockerfile: install RDS CA bundle for direct Aurora SSL connections
  const dockerfilePath = joinPathFragments(names.sourceDir, 'Dockerfile');
  injectRdsCaBundleIntoDockerfile(tree, dockerfilePath);
  trustRdsCaBundleInNode(tree, dockerfilePath);

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
    TS_RDB_CONTAINER_CONNECTION_GENERATOR_INFO,
    toProjectRelativePath(serviceProject, getterPath),
    `${names.prefix}-${db.variableName}`,
    // The source component this connection is made from, so the pair is
    // identifiable rather than just the two projects.
    { sourcePath: options.sourceComponent?.path },
  );

  await addGeneratorMetricsIfApplicable(tree, [
    TS_RDB_CONTAINER_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);

  // Printed from the callback so it appears after Nx lists the changed files.
  const message = rdbContainerWiringMessage(names, db);
  return () => {
    logger.info(message);
  };
};

export default tsRdbContainerConnectionGenerator;
