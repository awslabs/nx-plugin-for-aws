/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** Which code the executor generates from an OpenAPI specification. */
export type OpenApiCodegenTarget =
  | 'ts-client'
  | 'ts-hooks'
  | 'ts-metadata'
  | 'json-metadata';

export interface OpenApiCodegenExecutorSchema {
  generator: OpenApiCodegenTarget;
  openApiSpecPath: string;
  outputPath: string;
  dryRun?: boolean;
}
