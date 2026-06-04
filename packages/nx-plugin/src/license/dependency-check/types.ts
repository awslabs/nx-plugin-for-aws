/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AllowlistEntry {
  spdxId: string;
  fullName: string;
  aliases: string[];
}

export interface DependencyCheckException {
  package: string;
  version?: string;
  reason: string;
  spdx?: string;
}

export interface DependencyCheckConfig {
  allow: AllowlistEntry[];
  exceptions?: DependencyCheckException[];
  collectors?: import('./collectors/collector').LicenseCollector[];
  /**
   * Called once for every discovered dependency, with its package name and the
   * SPDX license expression resolved for it (an exception's `spdx` takes
   * precedence over the raw declared license; may be an empty string if no
   * license was declared). Useful for reporting — e.g. printing every
   * dependency's license. Invoked for all dependencies regardless of whether
   * the check passes.
   */
  onDependency?: (dependency: { package: string; spdx: string }) => void;
}

export type LicenseStatus = 'PRE_APPROVED' | 'UNKNOWN' | 'NOT_APPROVED';

export interface CheckedDependency {
  name: string;
  version: string;
  ecosystem: string;
  rawLicense: string;
  status: LicenseStatus;
  exception?: DependencyCheckException;
}

export interface CheckResult {
  pass: boolean;
  dependencies: CheckedDependency[];
}
