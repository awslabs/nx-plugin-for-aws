/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { IacOption } from '../../utils/iac';
import type { ModuleFormatOption } from '../../utils/module-format';

export interface TsDynamoDBGeneratorSchema {
  name: string;
  directory?: string;
  subDirectory?: string;
  framework: 'electrodb';
  tableName?: string;
  infra: 'dynamodb' | 'none';
  iac: IacOption;
  module?: ModuleFormatOption;
  preferInstallDependencies?: boolean;
}
