/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { libraryGenerator } from '@nx/js';
export interface TsProjectGeneratorSchema {
  name: Parameters<typeof libraryGenerator>[1]['name'];
  directory?: string;
  //   unitTestRunner?: Parameters<typeof libraryGenerator>[1]['unitTestRunner'];
  // TODO: test and consider exposing alternate bundlers
  // bundler?: Parameters<typeof libraryGenerator>[1]['bundler'];
  subDirectory?: string;
  preferInstallDependencies?: boolean;
}
