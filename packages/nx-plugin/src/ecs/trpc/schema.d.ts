/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { IacProviderOption } from '../../utils/iac';
import { TsProjectGeneratorSchema } from '../../ts/lib/schema';

export interface TsEcsTrpcApiGeneratorSchema {
  name: string;
  auth: 'IAM' | 'Cognito' | 'None';
  directory?: TsProjectGeneratorSchema['directory'];
  iacProvider: IacProviderOption;
}
