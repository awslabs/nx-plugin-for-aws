/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export interface TsRdbGeneratorSchema {
  name: string;
  directory?: string;
  service: 'Aurora';
  engine: 'Postgres' | 'MySQL';
  databaseUser: string;
  databaseName: string;
  ormFramework: 'Prisma';
}
