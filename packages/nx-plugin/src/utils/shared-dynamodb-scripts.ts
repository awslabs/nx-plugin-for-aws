/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  addDependenciesToPackageJson,
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  type Tree,
} from '@nx/devkit';
import {
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
} from './shared-constructs-constants';
import { ensureSharedScriptsProject } from './shared-scripts';
import { withVersions } from './versions';

/**
 * Ensures the shared scripts package exists and adds DynamoDB local-dev scripts
 * to packages/common/scripts/src/dynamodb/. Used by both ts#dynamodb and
 * py#dynamodb so a single set of TypeScript scripts serves both.
 */
export async function sharedDynamoDBScriptsGenerator(
  tree: Tree,
): Promise<void> {
  const scriptsDir = joinPathFragments(PACKAGES_DIR, SHARED_SCRIPTS_DIR);

  await ensureSharedScriptsProject(tree);

  generateFiles(
    tree,
    joinPathFragments(
      import.meta.dirname,
      'files',
      SHARED_SCRIPTS_DIR,
      'src',
      'dynamodb',
    ),
    joinPathFragments(scriptsDir, 'src', 'dynamodb'),
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );

  addDependenciesToPackageJson(
    tree,
    withVersions(['@aws-sdk/client-dynamodb']),
    withVersions(['tsx']),
  );
}
