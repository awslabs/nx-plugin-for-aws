/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export interface ObservabilityLangfuseGeneratorSchema {
  project: string;
  agent?: string;
  mode?: 'langfuse' | 'cloudwatch';
  host?: string;
  secretArn?: string;
  preferInstallDependencies?: boolean;
}
