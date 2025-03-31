/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  generateFiles,
  joinPathFragments,
  OverwriteStrategy,
  Tree,
} from '@nx/devkit';
import {
  PACKAGES_DIR,
  SHARED_CONSTRUCTS_DIR,
} from './shared-constructs-constants';
import { addStarExport } from './ast';

export const addLambdaHandler = (tree: Tree, handlerName: string) => {
  const shouldGenerateCoreLambdaHandlerConstruct = !tree.exists(
    joinPathFragments(
      PACKAGES_DIR,
      SHARED_CONSTRUCTS_DIR,
      'src',
      'core',
      'lambda-handler.ts',
    ),
  );
  if (shouldGenerateCoreLambdaHandlerConstruct) {
    generateFiles(
      tree,
      joinPathFragments(
        __dirname,
        'files',
        'lambda-handler',
        SHARED_CONSTRUCTS_DIR,
        'src',
        'core',
      ),
      joinPathFragments(PACKAGES_DIR, SHARED_CONSTRUCTS_DIR, 'src', 'core'),
      {},
      {
        overwriteStrategy: OverwriteStrategy.KeepExisting,
      },
    );
    addStarExport(
      tree,
      joinPathFragments(
        PACKAGES_DIR,
        SHARED_CONSTRUCTS_DIR,
        'src',
        'core',
        'index.ts',
      ),
      './lambda-handler.js',
    );
  }
};
