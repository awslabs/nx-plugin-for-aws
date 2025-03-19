/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { generateFiles, Tree } from '@nx/devkit';
import { OpenApiHooksSchema } from './schema';
import { parseOpenApiSpec } from '../utils/parse';
import { buildOpenApiCodeGenData } from '../utils/codegen-data';
import { generateOpenApiTsClient } from '../ts-client/generator';
import { formatFilesInSubtree } from '../../utils/format';
import path from 'path';
import { CodeGenData } from '../utils/codegen-data/types';

/**
 * Generates typescript hooks from an openapi spec
 */
export const openApiTsHooksGenerator = async (
  tree: Tree,
  options: OpenApiHooksSchema,
) => {
  const spec = await parseOpenApiSpec(tree, options.openApiSpecPath);

  const data = await buildOpenApiCodeGenData(spec);

  generateOpenApiTsClient(tree, data, options.outputPath);
  generateOpenApiTsHooks(tree, data, options.outputPath);

  await formatFilesInSubtree(tree);
};

/**
 * Generate OpenAPI typescript hooks in the target directory
 */
export const generateOpenApiTsHooks = (
  tree: Tree,
  data: CodeGenData,
  outputPath: string,
) => {
  generateFiles(tree, path.join(__dirname, 'files'), outputPath, data);
};

export default openApiTsHooksGenerator;
