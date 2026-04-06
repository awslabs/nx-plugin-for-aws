/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { IacProviderOption } from '../../utils/iac';

export interface TsRdbGeneratorSchema {
  name: string;
  directory?: string;
  service: 'Aurora';
  engine: 'Postgres' | 'MySQL';
  databaseUser: string;
  databaseName: string;
  ormFramework: 'Prisma';
  iacProvider: IacProviderOption;
}
