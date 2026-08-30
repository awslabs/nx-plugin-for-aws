/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { TargetConfiguration } from '@nx/devkit';
import type { OpenApiCodegenTarget } from '../open-api/codegen/executor-schema';
import { normalizeTargetKeyOrder } from './nx.js';

/** Executor generated OpenAPI codegen targets run. */
export const OPEN_API_CODEGEN_EXECUTOR = '@aws/nx-plugin:open-api-codegen';

export interface OpenApiCodegenTargetOptions {
  /** Which code to generate from the specification. */
  readonly generator: OpenApiCodegenTarget;
  /** Path to the OpenAPI specification, from the workspace root. */
  readonly openApiSpecPath: string;
  /** Directory to generate into, from the workspace root. */
  readonly outputPath: string;
  /** Target which builds the OpenAPI specification. */
  readonly specBuildTargetName: string;
  /** Paths the target writes, in Nx `outputs` form. */
  readonly outputs: string[];
}

/**
 * A target which generates code from an OpenAPI specification.
 *
 * The executor runs the generator in the Nx process that is already running,
 * rather than shelling out to `nx g`, which would pay a second full Nx
 * bootstrap for every codegen step.
 */
export const openApiCodegenTarget = ({
  generator,
  openApiSpecPath,
  outputPath,
  specBuildTargetName,
  outputs,
}: OpenApiCodegenTargetOptions): TargetConfiguration =>
  normalizeTargetKeyOrder({
    executor: OPEN_API_CODEGEN_EXECUTOR,
    dependsOn: [specBuildTargetName],
    cache: true,
    inputs: [
      {
        dependentTasksOutputFiles: '**/*.json',
      },
    ],
    outputs,
    options: {
      generator,
      openApiSpecPath,
      outputPath,
    },
  });
