/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { SPDXLicenseIdentifier } from './schema';

export interface LicenseConfig {
  /**
   * The SPDX license identifier for your chosen license.
   * License files will be synchronised according to the chosen SPDX
   */
  spdx: SPDXLicenseIdentifier;
  /**
   * The copyright holder for the license
   */
  copyrightHolder: string;
  /**
   * The copyright year (if any)
   */
  copyrightYear?: number;
  /**
   * Configuration for source code license headers
   * Omit if you do not want any source code license headers to be synced
   */
  header?: LicenseHeaderConfig;
  /**
   * Configuration for LICENSE files
   */
  files?: LicenseFileConfig;
}

/**
 * Configuration for the LICENSE file sync
 */
export interface LicenseFileConfig {
  /**
   * Exclude LICENSE file sync checks for the given glob patterns
   */
  exclude?: string[];
}

/**
 * Specifies license content as a path to a file
 */
export interface LicenseFilePathContent {
  /**
   * Load the license text from the specified file (relative to the workspace root)
   */
  filePath: string;
}

/**
 * Specifies license content inline
 */
export interface LicenseLinesContent {
  /**
   * Inline license text
   */
  lines: string[];
}

/**
 * Configuration for source code license header sync
 */
export interface LicenseHeaderConfig {
  /**
   * Content of the license header
   */
  content: LicenseFilePathContent | LicenseLinesContent;
  /**
   * Specifies the license header format for given glob patterns
   */
  format: {
    [filePattern: string]: LicenseHeaderFormat;
  };
  /**
   * Exclude out of sync source code license header checks for the given glob patterns
   */
  exclude?: string[];
  /**
   * User-specified comment syntax for file types we don't have config for
   */
  commentSyntax?: {
    [ext: string]: CommentSyntax;
  };
}

/**
 * Format settings for source code license headers
 */
export interface LicenseHeaderFormat {
  /**
   * Text written to the line prior to the license lines
   * Use this to start a block comment if desired
   */
  blockStart?: string;
  /**
   * Text written to the start of each line of the license
   */
  lineStart?: string;
  /**
   * Text written to the end of each line of the license
   */
  lineEnd?: string;
  /**
   * Text written to the line after the license lines
   * Use this to end a block comment if desired
   */
  blockEnd?: string;
}

/**
 * Defines comment syntax for a particular language
 * Used to instruct the license sync generator to find the first comment in a file
 */
export interface CommentSyntax {
  /**
   * If the language supports line comments, specify the character(s) used to start a line comment
   */
  line?: string;
  /**
   * If the language supports block comments, specify the character(s) used to start and end the block comment
   */
  block?: {
    start: string;
    end: string;
  };
}
