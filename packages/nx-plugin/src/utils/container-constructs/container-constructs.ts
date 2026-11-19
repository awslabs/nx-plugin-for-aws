/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  type ProjectConfiguration,
  type Tree,
  updateJson,
} from '@nx/devkit';
import type { Containers } from '../containers.js';
import type { Iac } from '../iac.js';
import { addArtifactProjectToTargets } from '../nx.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants.js';
import { addContainerServiceCdkConstructs } from './container-constructs-cdk.js';
import { addContainerServiceTerraformModules } from './container-constructs-terraform.js';

/**
 * The compute a container service runs on. `ecs` runs it as a private Amazon
 * ECS service on AWS Fargate, with no load balancer and no inbound rule on its
 * security group. `none` vends no infrastructure.
 */
export type ContainerInfra = 'ecs' | 'none';

/** Port the vended server listens on inside the container (`PORT`). */
export const CONTAINER_PORT = 8080;

/** Path the container health check calls. */
export const CONTAINER_HEALTH_CHECK_PATH = '/health';

/** The runtime of the vended image, which the health check command runs on. */
export type ContainerRuntime = 'node' | 'python';

/**
 * The container health check command for the vended image of `runtime`, in
 * the ECS task definition `healthCheck.command` form. It calls
 * `CONTAINER_HEALTH_CHECK_PATH` on the port in `PORT` (default
 * `CONTAINER_PORT`) and exits non-zero on a non-2xx answer or no answer.
 */
export const containerHealthCheckCommand = (
  runtime: ContainerRuntime,
): string[] =>
  runtime === 'node'
    ? [
        'CMD',
        'node',
        '-e',
        `fetch('http://127.0.0.1:'+(process.env.PORT||'${CONTAINER_PORT}')+'${CONTAINER_HEALTH_CHECK_PATH}',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))`,
      ]
    : [
        'CMD',
        'python',
        '-c',
        `import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '${CONTAINER_PORT}') + '${CONTAINER_HEALTH_CHECK_PATH}', timeout=3)`,
      ];

export interface AddContainerServiceInfraOptions {
  /** PascalCase service name: class names. */
  nameClassName: string;
  /** kebab-case service name: file names, module names, resource names. */
  nameKebabCase: string;
  /** Fully qualified Nx project name that holds the service. */
  projectName: string;
  /** Local image tag the `<name>-docker` target builds; Terraform publishes it. */
  dockerImageTag: string;
  /**
   * Workspace-relative directory holding the Dockerfile and the built bundle.
   * CDK builds its image asset from it.
   */
  dockerBuildContextDir: string;
  /** Port the server listens on inside the container. */
  containerPort: number;
  /**
   * Command ECS runs inside the container to check its health; it exits
   * non-zero when the server is unhealthy. See `containerHealthCheckCommand`.
   */
  healthCheckCommand: string[];
  containers: Containers;
}

/**
 * Vends the ECS service infrastructure for one container service with the
 * chosen IaC provider, and makes the shared infra project build after it.
 */
export const addContainerServiceInfra = async (
  tree: Tree,
  options: AddContainerServiceInfraOptions & { iac: Iac },
) => {
  if (options.iac === 'cdk') {
    await addContainerServiceCdkConstructs(tree, options);
  } else if (options.iac === 'terraform') {
    await addContainerServiceTerraformModules(tree, options);
  } else {
    throw new Error(`Unsupported iac ${options.iac}`);
  }

  updateJson(
    tree,
    joinPathFragments(
      PACKAGES_DIR,
      options.iac === 'cdk' ? SHARED_CONSTRUCTS_DIR : SHARED_TERRAFORM_DIR,
      'project.json',
    ),
    (config: ProjectConfiguration) => {
      addArtifactProjectToTargets(config, options.projectName);
      return config;
    },
  );
};
