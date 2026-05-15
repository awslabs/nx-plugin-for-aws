/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { IacProviderOption } from '../../utils/iac';

export interface TsDynamoDBGeneratorSchema {
  name: string;
  directory?: string;
  subDirectory?: string;
  tableName?: string;
  iacProvider: IacProviderOption;
}
