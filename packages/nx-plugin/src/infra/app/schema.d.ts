/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export interface TsInfraGeneratorSchema {
  name: string;
  ruleSet:
    | 'aws_prototyping'
    | 'cfn_nag'
    | 'hipaa'
    | 'nist_csf'
    | 'pci_dss_3_2_1'
    | 'well_architected_reliability'
    | 'well_architected_security';
  directory?: string;
  //   unitTestRunner?: 'jest' | 'vitest' | 'none';
  //   linter?: Linter;
  skipInstall?: boolean;
}
