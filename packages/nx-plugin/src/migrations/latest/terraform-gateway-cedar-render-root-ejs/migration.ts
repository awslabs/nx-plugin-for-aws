/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
} from '@nx/devkit';
import { AGENTCORE_GATEWAY_GENERATOR_INFO } from '../../../agentcore-gateway/generator.js';
import { addDependenciesToPackageJson } from '../../../utils/dependencies.js';
import { formatFilesInSubtree } from '../../../utils/format.js';
import {
  PACKAGES_DIR,
  SHARED_TERRAFORM_DIR,
} from '../../../utils/shared-constructs-constants.js';
import { TS_VERSIONS } from '../../../utils/versions.js';

/**
 * Declare `ejs` at the workspace root for Terraform gateways with Cedar
 * policies, which is where `render-cedar.cjs` resolves it from: the script runs
 * in the shared terraform project, which has no `package.json` of its own.
 */

const RENDER_SCRIPT = 'render-cedar.cjs';

export default async function migration(
  tree: Tree,
): Promise<MigrationReturnObject> {
  const gatewaysDir = joinPathFragments(
    PACKAGES_DIR,
    SHARED_TERRAFORM_DIR,
    'src',
    'app',
    'gateways',
  );
  let needsRootEjs = false;

  for (const project of getProjects(tree).values()) {
    const metadata = project.metadata as
      | { generator?: string; name?: string }
      | undefined;
    if (metadata?.generator !== AGENTCORE_GATEWAY_GENERATOR_INFO.id) {
      continue;
    }

    // Only a Terraform gateway with Cedar policies vends the render script; a
    // CDK one resolves ejs from the shared constructs project instead.
    if (
      tree.exists(
        joinPathFragments(gatewaysDir, metadata.name ?? '', RENDER_SCRIPT),
      )
    ) {
      needsRootEjs = true;
    }
  }

  if (needsRootEjs) {
    addDependenciesToPackageJson(tree, {}, { ejs: TS_VERSIONS.ejs });
  }

  await formatFilesInSubtree(tree);

  return {};
}
