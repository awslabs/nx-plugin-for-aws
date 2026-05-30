/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { TsProjectGeneratorSchema } from '../lib/schema';
import { IacProviderOption } from '../../utils/iac';

export interface TsApiGeneratorSchema {
  name: string;
  framework?: 'trpc' | 'smithy';
  namespace?: string;
  computeType: 'ServerlessApiGatewayRestApi' | 'ServerlessApiGatewayHttpApi';
  integrationPattern?: 'isolated' | 'shared';
  auth: 'IAM' | 'Cognito' | 'Custom';
  directory?: TsProjectGeneratorSchema['directory'];
  subDirectory?: TsProjectGeneratorSchema['subDirectory'];
  iacProvider: IacProviderOption;
}
