/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { joinPathFragments, type Tree } from '@nx/devkit';
import { buildOpenApiCodeGenerationData } from '../ts-client/generator.js';
import type { CodeGenData } from '../utils/codegen-data/types.js';
import type { OpenApiOperationsMetadataGeneratorSchema } from './schema';

/**
 * File name the operations metadata is written to. The Terraform modules read
 * this by name, so both the producing targets and the modules refer to it here.
 */
export const OPERATIONS_METADATA_FILE_NAME = 'operations.json';

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
 * Write the operations metadata for the given spec to the target directory,
 * sorted by operation name so the file is stable across runs and does not churn
 * the Terraform plan.
 */
export const generateOpenApiOperationsMetadata = (
  tree: Tree,
  data: CodeGenData,
  outputPath: string,
) => {
  const operations = Object.fromEntries(
    data.allOperations
      .map((op) => ({
        name: op.dotNotationName ?? op.name,
        path: op.path,
        method: op.method.toUpperCase(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, path, method }) => [name, { path, method }]),
  );

  tree.write(
    joinPathFragments(outputPath, OPERATIONS_METADATA_FILE_NAME),
    `${JSON.stringify(operations, null, 2)}\n`,
  );
};

export default openApiOperationsMetadataGenerator;
