/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export { licenseGenerator } from '../src/license/generator';
export type {
  AllowlistEntry,
  CollectedDependency,
  DependencyCheckConfig,
  DependencyCheckException,
  LicenseCollector,
} from '../src/license/index';
export {
  DEFAULT_LICENSE_ALLOWLIST,
  npmCollector,
  pythonCollector,
} from '../src/license/index';
export type { LicenseGeneratorSchema } from '../src/license/schema';
