/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export { PRE_APPROVED_LICENSES as DEFAULT_LICENSE_ALLOWLIST } from './dependency-check/pre-approved';
export type {
  AllowlistEntry,
  DependencyCheckConfig,
  DependencyCheckException,
} from './dependency-check/types';
export { npmCollector, pythonCollector } from './dependency-check/collector';
export type {
  LicenseCollector,
  CollectedDependency,
} from './dependency-check/collector';
