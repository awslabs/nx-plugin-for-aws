/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export { licenseGenerator } from '../license/generator.js';
export type {
  AllowlistEntry,
  CollectedDependency,
  DependencyCheckConfig,
  DependencyCheckException,
  LicenseCollector,
} from '../license/index.js';
export {
  DEFAULT_LICENSE_ALLOWLIST,
  npmCollector,
  pythonCollector,
} from '../license/index.js';
export type { LicenseGeneratorSchema } from '../license/schema';
