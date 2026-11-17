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

/** Path the vended server answers health checks on. */
export const CONTAINER_HEALTH_CHECK_PATH = '/health';

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
