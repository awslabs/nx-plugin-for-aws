/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { IacProviderOption } from '../../utils/iac';

export interface PyApiGeneratorSchema {
  readonly name: string;
  readonly framework?: 'fastapi';
  readonly infra: 'rest-lambda' | 'http-lambda';
  readonly integrationPattern?: 'isolated' | 'shared';
  readonly auth: 'iam' | 'cognito' | 'custom';
  readonly directory?: string;
  readonly subDirectory?: string;
  readonly moduleName?: string;
  readonly iacProvider: IacProviderOption;
}
