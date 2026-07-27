/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export interface SmithyProjectGeneratorSchema {
  name: string;
  type?: 'service' | 'shapes';
  serviceName?: string;
  namespace?: string;
  directory?: string;
  subDirectory?: string;
  preferInstallDependencies?: boolean;
}
