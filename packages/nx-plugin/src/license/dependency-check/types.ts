/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * An entry in the dependency license allowlist.
 *
 * Matches packages by SPDX ID (e.g. `MIT`), full name (e.g. `MIT License`),
 * or any alias commonly emitted by package metadata (e.g. `OSI Approved :: MIT License`).
 */
export interface AllowlistEntry {
  spdxId: string;
  fullName: string;
  aliases: string[];
}

/**
 * A per-package exception that overrides the allowlist for one package.
 */
export interface DependencyCheckException {
  /**
   * Package identifier (e.g. `mariadb`, `@modelcontextprotocol/inspector`).
   */
  package: string;
  /**
   * Optional exact version. If omitted the exception applies to every version
   * of the package found in the dependency tree.
   */
  version?: string;
  /**
   * Required reason text — surfaced in CI output so reviewers can see why the
   * exception was granted.
   */
  reason: string;
  /**
   * Optionally override the SPDX identifier for the package. Useful for
   * packages that ship without a license declaration but whose license is
   * known from upstream (e.g. `SEE LICENSE IN LICENSE`).
   */
  spdx?: string;
}

/**
 * Configuration for the dependency license check.
 *
 * Set `LicenseConfig.dependencyCheck` to `false` to disable the check.
 */
export interface DependencyCheckConfig {
  /**
   * Allowlist of licenses considered approved. The generator writes
   * `DEFAULT_LICENSE_ALLOWLIST` (imported from `@aws/nx-plugin/license`) by
   * default — override or extend as needed.
   */
  allow: AllowlistEntry[];
  /**
   * Per-package exceptions for packages whose license cannot be detected
   * from metadata (e.g. obfuscated packages, packages shipping LICENSE
   * files but no SPDX field).
   */
  exceptions?: DependencyCheckException[];
  /**
   * Collectors that discover dependencies and extract license metadata.
   * Defaults to [npmCollector(), pythonCollector()] if not specified.
   * Import collectors from `@aws/nx-plugin/license`.
   */
  collectors?: import('./collector').LicenseCollector[];
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
