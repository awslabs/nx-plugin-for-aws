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
import type {
  DependencyDeclaration,
  MustDeclare,
} from './declared-dependencies.js';
import { addDependenciesToPackageJson } from './dependencies.js';
import {
  PACKAGES_DIR,
  SHARED_SCRIPTS_DIR,
} from './shared-constructs-constants.js';
import { ensureSharedScriptsProject } from './shared-scripts.js';
import { type ITsDepVersion, withVersions } from './versions.js';

/** Dependencies a caller must declare to use the shared DynamoDB scripts. */
export const SHARED_DYNAMODB_SCRIPTS_DEPENDENCIES = [
  { name: '@aws-sdk/client-dynamodb' },
  { name: 'tsx' },
] as const satisfies readonly { name: ITsDepVersion }[];

/**
 * Ensures the shared scripts package exists and adds DynamoDB local-dev scripts
 * to packages/common/scripts/src/dynamodb/. Used by both ts#dynamodb and
 * py#dynamodb so a single set of TypeScript scripts serves both.
 */
export async function sharedDynamoDBScriptsGenerator<
  const D extends DependencyDeclaration,
>(
  tree: Tree,
  declaration: D & MustDeclare<typeof SHARED_DYNAMODB_SCRIPTS_DEPENDENCIES, D>,
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
    withVersions(
      declaration as DependencyDeclaration<
        typeof SHARED_DYNAMODB_SCRIPTS_DEPENDENCIES
      >,
      ['@aws-sdk/client-dynamodb'],
    ),
    {},
    joinPathFragments(PACKAGES_DIR, SHARED_SCRIPTS_DIR, 'package.json'),
  );
  addDependenciesToPackageJson(
    tree,
    {},
    withVersions(
      declaration as DependencyDeclaration<
        typeof SHARED_DYNAMODB_SCRIPTS_DEPENDENCIES
      >,
      ['tsx'],
    ),
  );
}
