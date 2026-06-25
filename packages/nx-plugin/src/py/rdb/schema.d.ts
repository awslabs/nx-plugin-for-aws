/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export interface PyRdbGeneratorSchema {
  name: string;
  directory?: string;
  subDirectory?: string;
  infra: 'aurora' | 'none';
  engine: 'postgres' | 'mysql';
  databaseUser?: string;
  databaseName?: string;
  iac?: 'inherit' | 'cdk' | 'terraform';
}
