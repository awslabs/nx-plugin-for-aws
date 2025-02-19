/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Tree } from '@nx/devkit';
import { OpenApiHooksSchema } from './schema';
import { parseOpenApiSpec } from '../utils/parse';
import { buildOpenApiCodeGenData } from '../utils/codegen-data';
import { generateOpenApiTsClient } from '../ts-client/generator';

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

  // TODO: generate hooks which wrap the client
};

export default openApiTsHooksGenerator;
