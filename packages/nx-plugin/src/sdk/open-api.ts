/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  buildOpenApiCodeGenerationData,
  openApiTsClientGenerator,
} from '../open-api/ts-client/generator.js';
export type { OpenApiTsClientGeneratorSchema } from '../open-api/ts-client/schema';

export { openApiTsHooksGenerator } from '../open-api/ts-hooks/generator.js';
export type { OpenApiTsHooksGeneratorSchema } from '../open-api/ts-hooks/schema';

export { openApiTsMetadataGenerator } from '../open-api/ts-metadata/generator.js';
export type { OpenApiTsMetadataGeneratorSchema } from '../open-api/ts-metadata/schema';
