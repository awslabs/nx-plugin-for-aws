/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The path and HTTP method of a single API operation.
 */
export interface OperationDetails {
  path: string;
  method: string;
}

/**
 * Operation names to their path and method, as consumed by the generated
 * Terraform modules to build one integration per operation.
 */
export type OperationsMetadata = Record<string, OperationDetails>;

/**
 * File name the operations metadata is written to. The Terraform modules read
 * this by name, so both the producing targets and the modules refer to it here.
 */
export const OPERATIONS_METADATA_FILE_NAME = 'operations.json';

/**
 * Serialise operations metadata for writing to disk, sorted by operation name
 * so the file is stable across runs and does not churn the Terraform plan.
 */
export const serialiseOperationsMetadata = (
  operations: OperationsMetadata,
): string =>
  `${JSON.stringify(
    Object.fromEntries(
      Object.entries(operations)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, { path, method }]) => [
          name,
          { path, method: method.toUpperCase() },
        ]),
    ),
    null,
    2,
  )}\n`;
