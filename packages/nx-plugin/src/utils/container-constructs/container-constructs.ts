/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  joinPathFragments,
  logger,
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
 * CPU architecture a container image is built for and its ECS task runs on.
 * `ARM64` runs on AWS Graviton, which costs less per task on AWS Fargate;
 * `X86_64` runs on Intel or AMD.
 */
export type ContainerArchitecture = 'ARM64' | 'X86_64';

/** The CPU architecture of the machine the generator is running on. */
export const hostArchitecture = (): ContainerArchitecture =>
  process.arch === 'arm64' ? 'ARM64' : 'X86_64';

/** The container build `--platform` value for `architecture`. */
export const containerBuildPlatform = (
  architecture: ContainerArchitecture,
): string => (architecture === 'ARM64' ? 'linux/arm64' : 'linux/amd64');

/**
 * The uv `--python-platform` that resolves wheels for `architecture`, so the
 * bundle a container image copies in holds libraries the task's CPU can run.
 */
export const containerPythonPlatform = (
  architecture: ContainerArchitecture,
): 'aarch64-manylinux_2_28' | 'x86_64-manylinux_2_28' =>
  architecture === 'ARM64' ? 'aarch64-manylinux_2_28' : 'x86_64-manylinux_2_28';

/**
 * The architecture to generate a container service for: the one the user asked
 * for, otherwise the one a previous run generated, otherwise the host's.
 *
 * Re-runs never re-detect over a value already in the vended code. A component
 * recorded without an architecture was generated before the option existed, and
 * its vended code is ARM64 whatever machine it was generated on.
 */
export const resolveContainerArchitecture = (
  requested?: ContainerArchitecture,
  recorded?: { readonly architecture?: ContainerArchitecture },
): ContainerArchitecture =>
  requested ??
  recorded?.architecture ??
  (recorded ? 'ARM64' : hostArchitecture());

/**
 * Warns when the image this service needs cannot be built natively on this
 * machine, naming both architectures and both ways out. Without an emulator the
 * build fails with nothing but `exec format error`.
 */
export const warnIfArchitectureNeedsEmulation = (
  architecture: ContainerArchitecture,
): void => {
  const host = hostArchitecture();
  if (architecture === host) {
    return;
  }
  const emulated = architecture === 'ARM64' ? 'arm64' : 'amd64';
  logger.warn(
    `This container service is built for ${architecture}, but this machine is ${host}. Building its image here needs an emulator, or it fails with "exec format error".\n` +
      `  - install one: docker run --privileged --rm tonistiigi/binfmt --install ${emulated}\n` +
      `  - or build for this machine: re-run the generator with --architecture=${host}`,
  );
};

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
  /**
   * CPU architecture the task runs on and the image is built for. Written into
   * the vended infrastructure as a literal, so it is fixed at generate time.
   */
  architecture: ContainerArchitecture;
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
