/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { generateFiles, Tree } from '@nx/devkit';
import { OpenApiClientSchema } from './schema';
import { parseOpenApiSpec } from '../utils/parse';
import { buildOpenApiCodeGenData } from '../utils/codegen-data';
import * as path from 'path';
import { CodeGenData } from '../utils/codegen-data/types';

/**
 * Generates typescript client from an openapi spec
 */
export const openApiTsClientGenerator = async (
  tree: Tree,
  options: OpenApiClientSchema,
) => {
  const spec = await parseOpenApiSpec(tree, options.openApiSpecPath);

  const data = await buildOpenApiCodeGenData(spec);

  generateOpenApiTsClient(tree, data, options.outputPath);
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
