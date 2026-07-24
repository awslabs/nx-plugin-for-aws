/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export type NxMigrationKind = 'deterministic' | 'agentic' | 'hybrid';

export interface NxMigrationGeneratorSchema {
  name: string;
  description: string;
  kind?: NxMigrationKind;
}
