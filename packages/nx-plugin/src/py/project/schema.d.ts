/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PyProjectGeneratorSchema {
  readonly name: string;
  readonly type: 'application' | 'library';
  readonly directory?: string;
  readonly subDirectory?: string;
  readonly moduleName?: string;
  readonly preferInstallDependencies?: boolean;
}
