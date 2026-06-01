/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TsProjectGeneratorSchema } from '../../../ts/lib/schema';
import { IacProviderOption } from '../../../utils/iac';

export interface TsSmithyApiGeneratorSchema {
  name: string;
  namespace?: string;
  infra: 'rest-lambda';
  integrationPattern?: 'isolated' | 'shared';
  auth: 'iam' | 'cognito' | 'custom';
  directory?: TsProjectGeneratorSchema['directory'];
  subDirectory?: TsProjectGeneratorSchema['subDirectory'];
  iacProvider: IacProviderOption;
}
