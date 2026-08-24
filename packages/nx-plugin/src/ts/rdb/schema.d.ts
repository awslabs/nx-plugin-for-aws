/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { IacOption } from '../../utils/iac.js';

export interface TsRdbGeneratorSchema {
  name: string;
  directory?: string;
  subDirectory?: string;
  infra: 'aurora' | 'none';
  engine: 'postgres' | 'mysql';
  databaseUser?: string;
  databaseName?: string;
  framework: 'prisma';
  iac: IacOption;
  preferInstallDependencies?: boolean;
}
