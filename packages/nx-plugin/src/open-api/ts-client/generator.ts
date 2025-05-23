/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { generateFiles, Tree } from '@nx/devkit';
import { OpenApiTsClientGeneratorSchema } from './schema';
import { parseOpenApiSpec } from '../utils/parse';
import { buildOpenApiCodeGenData } from '../utils/codegen-data';
import * as path from 'path';
import { CodeGenData } from '../utils/codegen-data/types';
import { formatFilesInSubtree } from '../../utils/format';

/**
 * Generates typescript client from an openapi spec
 */
export const openApiTsClientGenerator = async (
  tree: Tree,
  options: OpenApiTsClientGeneratorSchema,
) => {
  const data = await buildOpenApiCodeGenerationData(
    tree,
    options.openApiSpecPath,
  );

  generateOpenApiTsClient(tree, data, options.outputPath);

  await formatFilesInSubtree(tree);
};

/**
 * Build a data structure which can be used to generate code from OpenAPI
 */
export const buildOpenApiCodeGenerationData = async (
  tree: Tree,
  specPath: string,
) => {
  const spec = await parseOpenApiSpec(tree, specPath);
  return await buildOpenApiCodeGenData(spec);
};

/**
 * Generate an OpenAPI typescript client in the target directory
 */
export const generateOpenApiTsClient = (
  tree: Tree,
  data: CodeGenData,
  outputPath: string,
) => {
  generateFiles(tree, path.join(__dirname, 'files'), outputPath, data);
};

export default openApiTsClientGenerator;
