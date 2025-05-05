/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { generateFiles, Tree } from '@nx/devkit';
import { OpenApiMetadataSchema } from './schema';
import { parseOpenApiSpec } from '../utils/parse';
import { buildOpenApiCodeGenData } from '../utils/codegen-data';
import { formatFilesInSubtree } from '../../utils/format';
import path from 'path';
import { CodeGenData } from '../utils/codegen-data/types';

/**
 * Generates typescript metadata from an openapi spec
 */
export const openApiTsMetadataGenerator = async (
  tree: Tree,
  options: OpenApiMetadataSchema,
) => {
  const spec = await parseOpenApiSpec(tree, options.openApiSpecPath);

  const data = await buildOpenApiCodeGenData(spec);

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
