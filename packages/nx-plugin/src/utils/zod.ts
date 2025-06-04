/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, Tree, updateJson } from '@nx/devkit';

/**
 * Adds an alias for zod imports to point to zod v4 (for forward compatiblity when v4 is published to npm)
 */
export const addZodV4Alias = (tree: Tree) => {
  updateJson(tree, 'tsconfig.base.json', (tsConfig) => ({
    ...tsConfig,
    compilerOptions: {
      ...tsConfig.compilerOptions,
      paths: {
        // Filter out any existing entries for zod
        ...Object.fromEntries(
          Object.entries(tsConfig.compilerOptions?.paths ?? {}).filter(
            ([k]) => k !== 'zod',
          ),
        ),
        zod: ['./node_modules/zod/v4'],
      },
    },
  }));
};
