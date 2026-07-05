/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ModuleFormatOption } from '../../utils/module-format';

export interface TsInfraGeneratorSchema {
  name: string;
  directory?: string;
  subDirectory?: string;
  //   unitTestRunner?: 'jest' | 'vitest' | 'none';
  //   linter?: Linter;
  module?: ModuleFormatOption;
  preferInstallDependencies?: boolean;
  stageConfig?: boolean;
}
