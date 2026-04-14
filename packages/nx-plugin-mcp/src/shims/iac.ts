/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export const IAC_PROVIDERS = ['CDK', 'Terraform'] as const;
export type IacProvider = (typeof IAC_PROVIDERS)[number];
