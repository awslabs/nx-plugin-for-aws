/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ContainerArchitecture } from '../../utils/container-constructs/container-constructs.js';
import { IacOption } from '../../utils/iac.js';

export interface PyFastApiProjectGeneratorSchema {
  readonly name: string;
  readonly infra: 'rest-lambda' | 'http-lambda' | 'http-ecs' | 'none';
  readonly integrationPattern?: 'isolated' | 'shared';
  readonly auth: 'iam' | 'cognito' | 'custom';
  readonly directory?: string;
  readonly subDirectory?: string;
  readonly moduleName?: string;
  readonly iac: IacOption;
  readonly architecture?: ContainerArchitecture;
  readonly preferInstallDependencies?: boolean;
}
