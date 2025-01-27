/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { LibraryGeneratorSchema } from '@nx/js/src/utils/schema';
export interface TsLibGeneratorSchema {
  name: LibraryGeneratorSchema['name'];
  directory?: string;
  //   unitTestRunner?: LibraryGeneratorSchema['unitTestRunner'];
  // TODO: test and consider exposing alternate bundlers
  // bundler?: LibraryGeneratorSchema['bundler'];
  subDirectory?: string;
  skipInstall?: boolean;
}
