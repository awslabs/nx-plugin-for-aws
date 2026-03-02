/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Linter } from '@nx/eslint';
import { IacProviderOption } from '../../utils/iac';
import { TsProjectGeneratorSchema } from '../../ts/lib/schema';

export interface TsTrpcApiGeneratorSchema {
  name: string;
  computeType: 'ServerlessApiGatewayRestApi' | 'ServerlessApiGatewayHttpApi';
  integrationStyle?: 'Individual Functions' | 'Router';
  auth: 'IAM' | 'Cognito' | 'None';
  directory?: TsProjectGeneratorSchema['directory'];
  iacProvider: IacProviderOption;
}
