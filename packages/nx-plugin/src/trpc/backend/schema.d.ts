/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { Linter } from '@nx/eslint';

export interface TrpcBackendGeneratorSchema {
  apiName: string;
  bundler: TsLibGeneratorSchema['bundler'];
  directory?: TsLibGeneratorSchema['directory'];
  unitTestRunner: TsLibGeneratorSchema['unitTestRunner'];
  linter?: Linter;
}
