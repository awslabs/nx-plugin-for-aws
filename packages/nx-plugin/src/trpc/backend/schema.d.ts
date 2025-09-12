/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Linter } from '@nx/eslint';
import { IacProviderOption } from '../../utils/iac';

export interface TsTrpcApiGeneratorSchema {
  name: string;
  computeType: 'ServerlessApiGatewayRestApi' | 'ServerlessApiGatewayHttpApi';
  auth: 'IAM' | 'Cognito' | 'None';
  directory?: TsLibGeneratorSchema['directory'];
  iacProvider: IacProviderOption;
}
