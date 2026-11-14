/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  type GeneratorCallback,
  joinPathFragments,
  type Tree,
} from '@nx/devkit';
import type { ContainerMetadata } from '../../utils/container-constructs/container-metadata.js';
import { resolveContainerOptions } from '../../utils/container-constructs/container-metadata.js';
import { formatFilesInSubtree } from '../../utils/format.js';
import { resolveIac } from '../../utils/iac.js';
import { installDependencies } from '../../utils/install.js';
import { addGeneratorMetricsIfApplicable } from '../../utils/metrics.js';
import { kebabCase, toClassName } from '../../utils/names.js';
import {
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx.js';
import { assignPort } from '../../utils/port.js';
import type { TsContainerGeneratorSchema } from './schema';

export const TS_CONTAINER_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

/**
 * Adds a containerised HTTP service to a TypeScript project.
 *
 * Contract skeleton: resolves the options and records the component metadata
 * the connection generators read. The server, Dockerfile, targets and the
 * `addContainerServiceInfra` call are added by the ts#container lane.
 */
export const tsContainerGenerator = async (
  tree: Tree,
  options: TsContainerGeneratorSchema,
): Promise<GeneratorCallback> => {
  const project = readProjectConfigurationUnqualified(tree, options.project);

  if (!tree.exists(joinPathFragments(project.root, 'tsconfig.json'))) {
    throw new Error(
      `Unsupported project ${options.project}. Expected a TypeScript project (with a tsconfig.json)`,
    );
  }

  // Same naming as ts#agent: an unnamed service is `<project>-service` for
  // resource and class names, and `service` for targets and the source folder.
  const name = kebabCase(
    options.name || `${kebabCase(project.name.split('/').pop())}-service`,
  );
  const targetPrefix = options.name ? name : 'service';
  const nameClassName = toClassName(name);
  const sourceDirRelativeToProjectRoot = joinPathFragments('src', targetPrefix);

  const resolved = resolveContainerOptions(options);
  const iac =
    resolved.infra === 'ecs' ? await resolveIac(tree, options.iac) : undefined;

  const port = assignPort(tree, project, 8081, {
    component: { info: TS_CONTAINER_GENERATOR_INFO, name: targetPrefix },
  });

  // TODO(ts#container lane): vend the server, Dockerfile, .dockerignore, the
  // serve / <name>-docker / <name>-trivy targets, and, when infra is ecs, the
  // shared constructs and addContainerServiceInfra(tree, { ..., iac }).

  const metadata: ContainerMetadata = {
    infra: resolved.infra,
    ...(resolved.ingress ? { ingress: resolved.ingress } : {}),
    ...(resolved.auth ? { auth: resolved.auth } : {}),
    port,
    rc: nameClassName,
    ...(iac ? { iac } : {}),
  };

  addComponentGeneratorMetadata(
    tree,
    project.name,
    TS_CONTAINER_GENERATOR_INFO,
    sourceDirRelativeToProjectRoot,
    targetPrefix,
    metadata,
  );

  await addGeneratorMetricsIfApplicable(tree, [TS_CONTAINER_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript'],
    });
};

export default tsContainerGenerator;
