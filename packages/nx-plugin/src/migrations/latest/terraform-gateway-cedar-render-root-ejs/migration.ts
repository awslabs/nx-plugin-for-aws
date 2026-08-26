/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  getProjects,
  joinPathFragments,
  type MigrationReturnObject,
  type Tree,
  updateJson,
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
 * policies.
 *
 * `render-cedar.cjs` requires `ejs` and is run by an `external` data source
 * from `packages/common/terraform/src/app/gateways/<name>/`. That directory
 * belongs to the shared terraform project, which has no `package.json`, so
 * under pnpm's isolated node_modules nothing above the script provided `ejs`
 * and `terraform apply` failed reading the data source. The workspace root is
 * the nearest manifest the script can resolve against.
 *
 * The redundant copy in each gateway project's manifest is dropped, since
 * nothing in a gateway project imports `ejs`. A version the user pinned
 * themselves (a non-`catalog:` specifier) is left alone.
 */

const RENDER_SCRIPT = 'render-cedar.cjs';

/** Drop `ejs` / `@types/ejs` from a gateway project's manifest. */
const removeUnusedEjs = (tree: Tree, manifestPath: string): void => {
  if (!tree.exists(manifestPath)) {
    return;
  }
  updateJson(tree, manifestPath, (json) => {
    for (const field of ['dependencies', 'devDependencies'] as const) {
      for (const name of ['ejs', '@types/ejs']) {
        if (json[field]?.[name] === 'catalog:') {
          delete json[field][name];
        }
      }
    }
    return json;
  });
};

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
      !tree.exists(
        joinPathFragments(gatewaysDir, metadata.name ?? '', RENDER_SCRIPT),
      )
    ) {
      continue;
    }

    needsRootEjs = true;
    removeUnusedEjs(tree, joinPathFragments(project.root, 'package.json'));
  }

  if (needsRootEjs) {
    addDependenciesToPackageJson(tree, {}, { ejs: TS_VERSIONS.ejs });
  }

  await formatFilesInSubtree(tree);

  return {};
}
