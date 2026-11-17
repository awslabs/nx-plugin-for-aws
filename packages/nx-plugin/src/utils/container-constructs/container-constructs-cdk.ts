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
import { addStarExport } from '../ast.js';
import { esmVars } from '../module-format.js';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from '../shared-constructs-constants.js';
import type { AddContainerServiceInfraOptions } from './container-constructs.js';

/**
 * Vends the CDK side of a container service: the reusable `EcsService`
 * construct under `core/container/` (from
 * `files/cdk/core/container/ecs-service.ts.template`) and the per-service
 * subclass under `app/services/<name>.ts`, with star exports. Both are written
 * `KeepExisting`, so a re-run leaves user edits alone.
 */
export const addContainerServiceCdkConstructs = async (
  tree: Tree,
  options: AddContainerServiceInfraOptions,
): Promise<void> => {
  const constructsSrc = joinPathFragments(
    PACKAGES_DIR,
    SHARED_CONSTRUCTS_DIR,
    'src',
  );
  // Interim values for the templates that still render a load balancer and
  // an HTTP API: an internal load balancer and no API.
  const templateVars = {
    ...options,
    ingress: 'private',
    auth: 'none',
    ...esmVars(tree),
  };

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'core', 'container'),
    joinPathFragments(constructsSrc, 'core', 'container'),
    templateVars,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  generateFiles(
    tree,
    joinPathFragments(import.meta.dirname, 'files', 'cdk', 'app', 'services'),
    joinPathFragments(constructsSrc, 'app', 'services'),
    templateVars,
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  await addStarExport(
    tree,
    joinPathFragments(constructsSrc, 'core', 'index.ts'),
    './container/ecs-service.js',
  );
  await addStarExport(
    tree,
    joinPathFragments(constructsSrc, 'app', 'services', 'index.ts'),
    `./${options.nameKebabCase}.js`,
  );
  await addStarExport(
    tree,
    joinPathFragments(constructsSrc, 'app', 'index.ts'),
    './services/index.js',
  );
};
