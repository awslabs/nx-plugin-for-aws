/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import type { AddContainerServiceInfraOptions } from './container-constructs.js';

/**
 * Vends the Terraform side of a container service: the reusable
 * `core/container/ecs-service` module (from
 * `files/terraform/core/container/ecs-service/`) and the per-service module
 * under `app/services/<name>/<name>.tf`, which publishes the image to the
 * shared `core/asset-ecr` repository and writes the service URL to runtime
 * config.
 *
 * Contract stub: writes nothing yet. Owned by the Terraform lane.
 */
export const addContainerServiceTerraformModules = async (
  _tree: Tree,
  _options: AddContainerServiceInfraOptions,
): Promise<void> => {
  // TODO(Terraform lane): generateFiles for files/terraform/core and
  // files/terraform/app with OverwriteStrategy.KeepExisting and
  // terraformProviderVersions() (see utils/rdb-constructs).
};
