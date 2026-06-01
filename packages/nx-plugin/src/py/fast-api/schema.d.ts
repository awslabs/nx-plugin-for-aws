/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { IacOption } from '../../utils/iac';

export interface PyFastApiProjectGeneratorSchema {
  readonly name: string;
  readonly infra: 'rest-lambda' | 'http-lambda' | 'none';
  readonly integrationPattern?: 'isolated' | 'shared';
  readonly auth: 'iam' | 'cognito' | 'custom';
  readonly directory?: string;
  readonly subDirectory?: string;
  readonly moduleName?: string;
  readonly iac: IacOption;
}
