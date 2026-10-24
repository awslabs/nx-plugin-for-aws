/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export interface GreengrassComponentGeneratorSchema {
  project: string;
  name: string;
  language?: 'typescript' | 'python';
  componentName?: string;
  componentVersion?: string;
  publisher?: string;
  ipc?: boolean;
  gdkConfig?: boolean;
  platform?: 'linux-amd64' | 'linux-arm64' | 'linux-amd64-arm64';
  infra?: 'component-version' | 'none';
  iac?: 'inherit' | 'cdk' | 'terraform';
  preferInstallDependencies?: boolean;
}
