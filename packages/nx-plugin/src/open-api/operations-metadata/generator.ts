/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, type Tree } from '@nx/devkit';
import {
  OPERATIONS_METADATA_FILE_NAME,
  type OperationsMetadata,
  serialiseOperationsMetadata,
} from '../../utils/api-constructs/operations.js';
import { buildOpenApiCodeGenerationData } from '../ts-client/generator.js';
import type { CodeGenData } from '../utils/codegen-data/types.js';
import type { OpenApiOperationsMetadataGeneratorSchema } from './schema';

/**
 * Generates an operations metadata JSON file from an OpenAPI specification,
 * read by the vended Terraform modules to define one integration per operation.
 */
export const openApiOperationsMetadataGenerator = async (
  tree: Tree,
  options: OpenApiOperationsMetadataGeneratorSchema,
) => {
  const data = await buildOpenApiCodeGenerationData(
    tree,
    options.openApiSpecPath,
  );

  generateOpenApiOperationsMetadata(tree, data, options.outputPath);
};

/**
 * Write the operations metadata for the given spec to the target directory
 */
export const generateOpenApiOperationsMetadata = (
  tree: Tree,
  data: CodeGenData,
  outputPath: string,
) => {
  const operations: OperationsMetadata = Object.fromEntries(
    data.allOperations.map((op) => [
      op.dotNotationName ?? op.name,
      { path: op.path, method: op.method },
    ]),
  );

  tree.write(
    joinPathFragments(outputPath, OPERATIONS_METADATA_FILE_NAME),
    serialiseOperationsMetadata(operations),
  );
};

export default openApiOperationsMetadataGenerator;
