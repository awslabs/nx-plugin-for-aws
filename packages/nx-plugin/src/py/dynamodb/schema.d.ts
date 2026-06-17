/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { IacOption } from '../../utils/iac';

export interface PyDynamoDBGeneratorSchema {
  name: string;
  directory?: string;
  subDirectory?: string;
  framework: 'pynamodb';
  tableName?: string;
  infra: 'dynamodb' | 'none';
  iac: IacOption;
}
