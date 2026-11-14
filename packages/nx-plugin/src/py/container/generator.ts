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
import { kebabCase, toClassName, toSnakeCase } from '../../utils/names.js';
import {
  addComponentGeneratorMetadata,
  getGeneratorInfo,
  type NxGeneratorInfo,
  readProjectConfigurationUnqualified,
} from '../../utils/nx.js';
import { toProjectRelativePath } from '../../utils/paths.js';
import { assignPort } from '../../utils/port.js';
import type { PyContainerGeneratorSchema } from './schema';

export const PY_CONTAINER_GENERATOR_INFO: NxGeneratorInfo = getGeneratorInfo(
  import.meta.filename,
);

/**
 * Adds a containerised HTTP service (FastAPI on uvicorn) to a Python project.
 *
 * Contract skeleton: resolves the options and records the component metadata
 * the connection generators read. The server, Dockerfile, targets and the
 * `addContainerServiceInfra` call are added by the py#container lane.
 */
export const pyContainerGenerator = async (
  tree: Tree,
  options: PyContainerGeneratorSchema,
): Promise<GeneratorCallback> => {
  const project = readProjectConfigurationUnqualified(tree, options.project);

  if (!tree.exists(joinPathFragments(project.root, 'pyproject.toml'))) {
    throw new Error(
      `Unsupported project ${options.project}. Expected a Python project (with a pyproject.toml)`,
    );
  }

  if (!project.sourceRoot) {
    throw new Error(
      `This project does not have a source root. Please add a source root to the project configuration before running this generator.`,
    );
  }

  // Same naming as py#agent: an unnamed service is `<project>-service` for
  // resource and class names, and `service` for targets; the source folder is
  // the snake_case name inside the project's module.
  const name = kebabCase(
    options.name || `${kebabCase(project.name.split('.').pop())}-service`,
  );
  const targetPrefix = options.name ? name : 'service';
  const nameClassName = toClassName(name);
  const sourceDir = joinPathFragments(
    project.sourceRoot,
    toSnakeCase(options.name || 'service'),
  );

  const resolved = resolveContainerOptions(options);
  const iac =
    resolved.infra === 'ecs' ? await resolveIac(tree, options.iac) : undefined;

  const port = assignPort(tree, project, 8081, {
    component: { info: PY_CONTAINER_GENERATOR_INFO, name: targetPrefix },
  });

  // TODO(py#container lane): vend the FastAPI server, Dockerfile, .dockerignore,
  // the serve / <name>-docker / <name>-trivy targets, and, when infra is ecs,
  // the shared constructs and addContainerServiceInfra(tree, { ..., iac }).

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
    PY_CONTAINER_GENERATOR_INFO,
    toProjectRelativePath(project, sourceDir),
    targetPrefix,
    metadata,
  );

  await addGeneratorMetricsIfApplicable(tree, [PY_CONTAINER_GENERATOR_INFO]);

  await formatFilesInSubtree(tree);
  return () =>
    installDependencies(tree, options.preferInstallDependencies, {
      languages: ['typescript', 'python'],
    });
};

export default pyContainerGenerator;
