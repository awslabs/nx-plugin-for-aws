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

/** The compute a container service runs on. `none` vends no infrastructure. */
export type ContainerInfra = 'ecs' | 'none';

/**
 * How callers reach a container service.
 *
 * `http-api` fronts an internal Application Load Balancer with an API Gateway
 * HTTP API through a VPC link. `private` vends only the internal load balancer,
 * for callers inside the VPC.
 */
export type ContainerIngress = 'http-api' | 'private';

/** How the HTTP API in front of a service authenticates (`http-api` only). */
export type ContainerAuth = 'iam' | 'cognito' | 'none';

/** Port the vended server listens on inside the container (`PORT`). */
export const CONTAINER_PORT = 8080;

/** Path the load balancer target group health check calls. */
export const CONTAINER_HEALTH_CHECK_PATH = '/health';

/**
 * Runtime-config namespace and key a deployed service's URL is written under,
 * as `connection.services.<NameClassName>`, the same shape API URLs use
 * (`connection.apis.<ApiNameClassName>`).
 */
export const CONTAINER_RUNTIME_CONFIG_NAMESPACE = 'connection';
export const CONTAINER_RUNTIME_CONFIG_KEY = 'services';

export interface AddContainerServiceInfraOptions {
  /** PascalCase service name: class names and the runtime-config key. */
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
  ingress: ContainerIngress;
  auth: ContainerAuth;
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
