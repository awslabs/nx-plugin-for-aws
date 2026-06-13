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
  SHARED_TS_DYNAMODB_SCRIPTS_DIR,
} from '../shared-constructs-constants';

export const sharedTsDynamoDBScriptsGenerator = (tree: Tree): void => {
  generateFiles(
    tree,
    joinPathFragments(__dirname, 'files'),
    joinPathFragments(PACKAGES_DIR, SHARED_TS_DYNAMODB_SCRIPTS_DIR),
    {},
    { overwriteStrategy: OverwriteStrategy.KeepExisting },
  );
};
