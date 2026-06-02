/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TsProjectGeneratorSchema } from '../lib/schema';
import { IacOption } from '../../utils/iac';

export interface TsApiGeneratorSchema {
  name: string;
  framework?: 'trpc' | 'smithy';
  namespace?: string;
  infra: 'rest-lambda' | 'http-lambda' | 'none';
  integrationPattern?: 'isolated' | 'shared';
  auth: 'iam' | 'cognito' | 'custom';
  directory?: TsProjectGeneratorSchema['directory'];
  subDirectory?: TsProjectGeneratorSchema['subDirectory'];
  iac: IacOption;
}
