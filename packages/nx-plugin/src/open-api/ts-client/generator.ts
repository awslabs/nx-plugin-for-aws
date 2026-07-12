/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { generateFiles, logger, type Tree } from '@nx/devkit';
import * as path from 'path';
import { formatFilesInSubtree } from '../../utils/format';
import { esmVars } from '../../utils/module-format';
import { buildOpenApiCodeGenData } from '../utils/codegen-data';
import type { CodeGenData } from '../utils/codegen-data/types';
import { parseOpenApiSpec } from '../utils/parse';
import type { Spec } from '../utils/types';
import type { OpenApiTsClientGeneratorSchema } from './schema';

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
  warnForUnsupportedFeatures(spec);
  return buildOpenApiCodeGenData(spec);
};

/**
 * Warn for spec features the generated client does not implement, so their
 * omission is never silent.
 */
const warnForUnsupportedFeatures = (spec: Spec) => {
  if (Object.keys((spec as { webhooks?: object }).webhooks ?? {}).length > 0) {
    logger.warn(
      'OpenAPI webhooks are not supported and no client code is generated for them',
    );
  }
  for (const [p, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(pathItem ?? {})) {
      if (typeof op !== 'object' || op === null) continue;
      const operation = op as {
        callbacks?: object;
        servers?: unknown[];
      };
      if (Object.keys(operation.callbacks ?? {}).length > 0) {
        logger.warn(
          `Operation ${method.toUpperCase()} ${p} declares callbacks, which are not supported and are ignored`,
        );
      }
      if ((operation.servers ?? []).length > 0) {
        logger.warn(
          `Operation ${method.toUpperCase()} ${p} declares operation-level servers, which are ignored — the client always uses its configured url`,
        );
      }
    }
  }
};

/**
 * Generate an OpenAPI typescript client in the target directory
 */
export const generateOpenApiTsClient = (
  tree: Tree,
  data: CodeGenData,
  outputPath: string,
) => {
  generateFiles(
    tree,
    path.join(import.meta.dirname, 'files'),
    outputPath,
    { ...data, ...esmVars(tree) },
  );
};

export default openApiTsClientGenerator;
