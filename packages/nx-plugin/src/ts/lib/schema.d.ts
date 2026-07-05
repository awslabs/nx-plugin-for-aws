/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LibraryGeneratorSchema } from '@nx/js/src/utils/schema';
import type { ModuleFormatOption } from '../../utils/module-format';
export interface TsProjectGeneratorSchema {
  name: LibraryGeneratorSchema['name'];
  directory?: string;
  //   unitTestRunner?: LibraryGeneratorSchema['unitTestRunner'];
  // TODO: test and consider exposing alternate bundlers
  // bundler?: LibraryGeneratorSchema['bundler'];
  subDirectory?: string;
  module?: ModuleFormatOption;
  preferInstallDependencies?: boolean;
}
