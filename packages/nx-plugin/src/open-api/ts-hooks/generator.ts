/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { generateFiles, type Tree } from '@nx/devkit';
import path from 'path';
import { formatFilesInSubtree } from '../../utils/format';
import {
  buildOpenApiCodeGenerationData,
  generateOpenApiTsClient,
} from '../ts-client/generator';
import type { CodeGenData } from '../utils/codegen-data/types';
import type { OpenApiTsHooksGeneratorSchema } from './schema';

/**
 * Generates typescript hooks from an openapi spec
 */
export const openApiTsHooksGenerator = async (
  tree: Tree,
  options: OpenApiTsHooksGeneratorSchema,
) => {
  const data = await buildOpenApiCodeGenerationData(
    tree,
    options.openApiSpecPath,
  );

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
