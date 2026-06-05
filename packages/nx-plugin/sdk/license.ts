/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export { DEFAULT_LICENSE_ALLOWLIST } from '../src/license/index';
export type {
  AllowlistEntry,
  DependencyCheckConfig,
  DependencyCheckException,
} from '../src/license/index';
export { npmCollector, pythonCollector } from '../src/license/index';
export type {
  LicenseCollector,
  CollectedDependency,
} from '../src/license/index';
