/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PyFastApiProjectGeneratorSchema {
  readonly name: string;
  readonly computeType:
    | 'ServerlessApiGatewayRestApi'
    | 'ServerlessApiGatewayHttpApi';
  readonly auth: 'IAM' | 'Cognito' | 'None';
  readonly directory?: string;
  readonly moduleName?: string;
}
