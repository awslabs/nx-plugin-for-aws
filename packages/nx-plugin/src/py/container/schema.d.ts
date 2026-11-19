/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ContainerInfra } from '../../utils/container-constructs/container-constructs.js';
import type { IacOption } from '../../utils/iac.js';

export interface PyContainerGeneratorSchema {
  project: string;
  name?: string;
  infra?: ContainerInfra;
  iac: IacOption;
  preferInstallDependencies?: boolean;
}
