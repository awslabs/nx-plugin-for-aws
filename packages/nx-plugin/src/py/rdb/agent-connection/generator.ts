/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  joinPathFragments,
  type Tree,
  updateProjectConfiguration,
} from '@nx/devkit';
import { formatFilesInSubtree } from '../../../utils/format.js';
import { installDependencies } from '../../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../../utils/metrics.js';
import { toSnakeCase } from '../../../utils/names.js';
import {
  addComponentGeneratorMetadata,
  addDependencyToTargetIfNotPresent,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../../utils/nx.js';
import { addWorkspaceDependencyToPyProject } from '../../../utils/py.js';
import { injectRdsCaBundleIntoDockerfile } from '../utils.js';
import type { PyRdbAgentConnectionGeneratorSchema } from './schema';

export const PY_RDB_AGENT_CONNECTION_GENERATOR_INFO: NxGeneratorInfo =
  getGeneratorInfo(import.meta.filename);

export const pyRdbAgentConnectionGenerator = async (
  tree: Tree,
  options: PyRdbAgentConnectionGeneratorSchema,
): Promise<GeneratorCallback> => {
  const sourceProject = readProjectConfigurationUnqualified(
    tree,
    options.sourceProject,
  );
  const targetProject = readProjectConfigurationUnqualified(
    tree,
    options.targetProject,
  );

  addWorkspaceDependencyToPyProject(tree, sourceProject, targetProject);

  const agentName = options.sourceComponent?.name ?? 'agent';
  const devTarget = `${agentName}-dev`;
  const agentSourceDir = options.sourceComponent?.path
    ? joinPathFragments(sourceProject.root, options.sourceComponent.path)
    : sourceProject.sourceRoot
      ? joinPathFragments(sourceProject.sourceRoot, toSnakeCase(agentName))
      : undefined;
  const dockerfilePath = agentSourceDir
    ? joinPathFragments(agentSourceDir, 'Dockerfile')
    : undefined;

  if (dockerfilePath) {
    injectRdsCaBundleIntoDockerfile(tree, dockerfilePath);
  }

  if (sourceProject.targets?.[devTarget]) {
    addDependencyToTargetIfNotPresent(sourceProject, devTarget, {
      projects: [targetProject.name],
      target: 'dev',
    });
    updateProjectConfiguration(tree, sourceProject.name, sourceProject);
  }

  // Recorded so the version sync can identify this connection.
  addComponentGeneratorMetadata(
    tree,
    sourceProject.name,
    PY_RDB_AGENT_CONNECTION_GENERATOR_INFO,
    targetProject.root,
    `${agentName}-${targetProject.name}`,
    // The source component this connection is made from, so the pair is
    // identifiable rather than just the two projects.
    { sourcePath: options.sourceComponent?.path },
  );

  await addGeneratorMetricsIfApplicable(tree, [
    PY_RDB_AGENT_CONNECTION_GENERATOR_INFO,
  ]);
  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
};

export default pyRdbAgentConnectionGenerator;
