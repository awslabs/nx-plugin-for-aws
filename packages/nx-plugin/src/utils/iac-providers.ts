/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export const IAC_PROVIDERS = ['cdk', 'terraform'] as const;

export type Iac = (typeof IAC_PROVIDERS)[number];

export type IacOption = Iac | 'inherit';
