/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PyProjectGeneratorSchema {
  readonly name: string;
  readonly projectType: 'application' | 'library';
  readonly directory?: string;
  readonly moduleName?: string;
}
