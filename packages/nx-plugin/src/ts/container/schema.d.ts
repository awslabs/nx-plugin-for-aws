/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  ContainerAuth,
  ContainerInfra,
  ContainerIngress,
} from '../../utils/container-constructs/container-constructs.js';
import type { IacOption } from '../../utils/iac.js';

export interface TsContainerGeneratorSchema {
  project: string;
  name?: string;
  infra?: ContainerInfra;
  ingress?: ContainerIngress;
  auth?: ContainerAuth;
  iac: IacOption;
  preferInstallDependencies?: boolean;
}
