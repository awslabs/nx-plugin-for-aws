/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { generateFiles, Tree } from '@nx/devkit';
import { OpenApiTsMetadataGeneratorSchema } from './schema';
import { formatFilesInSubtree } from '../../utils/format';
import path from 'path';
import { CodeGenData } from '../utils/codegen-data/types';
import { buildOpenApiCodeGenerationData } from '../ts-client/generator';

/**
 * Generates typescript metadata from an openapi spec
 */
export const openApiTsMetadataGenerator = async (
  tree: Tree,
  options: OpenApiTsMetadataGeneratorSchema,
) => {
  const data = await buildOpenApiCodeGenerationData(
    tree,
    options.openApiSpecPath,
  );

  generateOpenApiTsMetadata(tree, data, options.outputPath);

  await formatFilesInSubtree(tree);
};

/**
 * Generate OpenAPI typescript metadata in the target directory
 */
export const generateOpenApiTsMetadata = (
  tree: Tree,
  data: CodeGenData,
  outputPath: string,
) => {
  generateFiles(tree, path.join(__dirname, 'files'), outputPath, data);
};

export default openApiTsMetadataGenerator;
