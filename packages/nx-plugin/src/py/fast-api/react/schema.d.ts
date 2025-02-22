/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export interface FastApiReactGeneratorSchema {
  frontendProjectName: string;
  fastApiProjectName: string;
  auth: 'IAM' | 'None';
}
