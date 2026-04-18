/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export type OpenApiPyClientClientType = 'sync' | 'async' | 'both';

export interface OpenApiPyClientGeneratorSchema {
  openApiSpecPath: string;
  outputPath: string;
  clientType?: OpenApiPyClientClientType;
}
