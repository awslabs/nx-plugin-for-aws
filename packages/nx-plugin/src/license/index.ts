/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export type {
  CollectedDependency,
  LicenseCollector,
} from './dependency-check/collectors/collector.js';
export {
  npmCollector,
  pythonCollector,
} from './dependency-check/collectors/collector.js';
export { PRE_APPROVED_LICENSES as DEFAULT_LICENSE_ALLOWLIST } from './dependency-check/pre-approved.js';
export type {
  AllowlistEntry,
  DependencyCheckConfig,
  DependencyCheckException,
} from './dependency-check/types.js';
