/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { TsProjectGeneratorSchema } from '../../ts/lib/schema';
import type { ContainerArchitecture } from '../../utils/container-constructs/container-constructs.js';
import { IacOption } from '../../utils/iac.js';

export interface TsTrpcApiGeneratorSchema {
  name: string;
  infra: 'rest-lambda' | 'http-lambda' | 'http-ecs' | 'none';
  integrationPattern?: 'isolated' | 'shared';
  auth: 'iam' | 'cognito' | 'custom';
  directory?: TsProjectGeneratorSchema['directory'];
  subDirectory?: TsProjectGeneratorSchema['subDirectory'];
  iac: IacOption;
  architecture?: ContainerArchitecture;
  preferInstallDependencies?: boolean;
}
