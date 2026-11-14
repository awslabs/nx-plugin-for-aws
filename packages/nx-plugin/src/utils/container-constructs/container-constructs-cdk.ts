/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Tree } from '@nx/devkit';
import type { AddContainerServiceInfraOptions } from './container-constructs.js';

/**
 * Vends the CDK side of a container service: the reusable `EcsService`
 * construct under `core/container/` (from
 * `files/cdk/core/container/ecs-service.ts.template`) and the per-service
 * subclass under `app/services/<name>.ts`, with star exports.
 *
 * Contract stub: writes nothing yet. Owned by the CDK lane.
 */
export const addContainerServiceCdkConstructs = async (
  _tree: Tree,
  _options: AddContainerServiceInfraOptions,
): Promise<void> => {
  // TODO(CDK lane): generateFiles for files/cdk/core and files/cdk/app with
  // OverwriteStrategy.KeepExisting, then addStarExport into core/index.ts,
  // app/services/index.ts and app/index.ts (see utils/rdb-constructs).
};
