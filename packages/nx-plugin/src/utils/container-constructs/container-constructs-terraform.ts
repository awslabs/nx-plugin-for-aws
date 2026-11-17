/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import {
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
} from '../shared-constructs-constants.js';
import { terraformProviderVersions } from '../versions.js';
import type { AddContainerServiceInfraOptions } from './container-constructs.js';

/**
 * Vends the Terraform side of a container service: the reusable
 * `core/container/ecs-service` module (from
 * `files/terraform/core/container/ecs-service/`) and the per-service module
 * under `app/services/<name>/<name>.tf`, which publishes the image to the
 * shared `core/asset-ecr` repository and writes the service URL to runtime
 * config. Existing files are kept, so a second service reuses the core module.
 */
export const addContainerServiceTerraformModules = async (
  tree: Tree,
  options: AddContainerServiceInfraOptions,
): Promise<void> => {
  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'terraform', 'core'),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'core'),
    { ...terraformProviderVersions() },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'terraform', 'app'),
    joinPathFragments(PACKAGES_DIR, SHARED_TERRAFORM_DIR, 'src', 'app'),
    // Interim values for the templates that still render a load balancer and
    // an HTTP API: an internal load balancer and no API.
    {
      ...options,
      ingress: 'private',
      auth: 'none',
      ...terraformProviderVersions(),
    },
    {
      overwriteStrategy: OverwriteStrategy.KeepExisting,
    },
  );
};
