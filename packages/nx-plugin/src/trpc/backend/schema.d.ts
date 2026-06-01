/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Linter } from '@nx/eslint';
import { IacProviderOption } from '../../utils/iac';
import { TsProjectGeneratorSchema } from '../../ts/lib/schema';

export interface TsTrpcApiGeneratorSchema {
  name: string;
  infra: 'rest-lambda' | 'http-lambda';
  integrationPattern?: 'isolated' | 'shared';
  auth: 'iam' | 'cognito' | 'custom';
  directory?: TsProjectGeneratorSchema['directory'];
  subDirectory?: TsProjectGeneratorSchema['subDirectory'];
  iacProvider: IacProviderOption;
}
