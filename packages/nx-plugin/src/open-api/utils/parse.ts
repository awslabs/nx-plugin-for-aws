/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import SwaggerParser from '@apidevtools/swagger-parser';
import { Spec } from './types';

const TREE_PROTOCOL_PREFIX = 'workspace://';

/**
 * Parse an OpenAPI specification given its path within the tree
 */
export const parseOpenApiSpec = async (
  tree: Tree,
  specPath: string,
): Promise<Spec> => {
  // Use a custom protocol prefix to ensure that the swagger parser doesn't try and read from the filesystem itself
  const spec = await SwaggerParser.bundle(
    `${TREE_PROTOCOL_PREFIX}/${specPath}`,
    {
      resolve: {
        // Use a custom resolver which reads files from the tree rather than directly from the filesystem
        file: {
          order: 1,
          read: (file) => {
            const path = file.url.slice(TREE_PROTOCOL_PREFIX.length);
            if (!tree.exists(path)) {
              const message = `Unable to find ${specPath} in workspace ${tree.root}`;

              // Write an error to console as swagger parser's error message may be confusing with our custom protocol prefix
              console.error(message);
              throw new Error(message);
            }
            return tree.read(path);
          },
          canRead: (file) => file.url.startsWith(TREE_PROTOCOL_PREFIX),
        },
        http: false,
      },
    },
  );

  if ('swagger' in spec) {
    throw new Error(
      `OpenAPI v2 specifications are not supported. Please use OpenAPI v3`,
    );
  }
  return spec;
};
