/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IacOption } from '../../../../utils/iac.js';

export interface TsWebsiteAuthIdpGeneratorSchema {
  type: 'oidc';
  name: string;
  issuerUrl: string;
  clientId: string;
  clientSecretName?: string;
  scopes?: string;
  attributeMapping?: string;
  identifiers?: string;
  iac: IacOption;
}
