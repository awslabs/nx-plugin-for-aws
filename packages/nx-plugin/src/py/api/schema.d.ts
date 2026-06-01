/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { IacProviderOption } from '../../utils/iac';

export interface PyApiGeneratorSchema {
  readonly name: string;
  readonly framework?: 'fastapi';
  readonly computeType:
    | 'ServerlessApiGatewayRestApi'
    | 'ServerlessApiGatewayHttpApi';
  readonly integrationPattern?: 'isolated' | 'shared';
  readonly auth: 'IAM' | 'Cognito' | 'Custom';
  readonly directory?: string;
  readonly subDirectory?: string;
  readonly moduleName?: string;
  readonly iacProvider: IacProviderOption;
}
