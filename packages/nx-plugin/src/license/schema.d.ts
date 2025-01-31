/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export type SPDXLicenseIdentifier = 'Apache-2.0' | 'MIT' | 'ASL';

export interface LicenseGeneratorSchema {
  /**
   * SPDX License Identifier
   */
  license: SPDXLicenseIdentifier;

  /**
   * Copyright holder name
   */
  copyrightHolder: string;
}
