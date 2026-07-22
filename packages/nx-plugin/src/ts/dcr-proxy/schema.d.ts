/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IacOption } from '../../utils/iac';

export interface TsDcrProxyGeneratorSchema {
  name?: string;
  directory?: string;
  subDirectory?: string;
  iac: IacOption;
  preferInstallDependencies?: boolean;
}
