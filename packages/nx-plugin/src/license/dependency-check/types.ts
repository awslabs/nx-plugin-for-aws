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
