/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { ProjectType } from '@nx/devkit';

export interface TerraformProjectGeneratorSchema {
  name: string;
  type: ProjectType;
  directory?: string;
  subDirectory?: string;
  preferInstallDependencies?: boolean;
}
