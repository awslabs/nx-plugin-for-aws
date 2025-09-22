/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export interface TsSmithyApiGeneratorSchema {
  name: string;
  namespace?: string;
  // Only API Gateway REST APIs are supported by Smithy
  // https://smithy.io/2.0/languages/typescript/ts-ssdk/supported-endpoints.html#amazon-api-gateway-rest-apis-and-aws-lambda
  computeType: 'ServerlessApiGatewayRestApi';
  auth: 'IAM' | 'Cognito' | 'None';
  directory?: TsProjectGeneratorSchema['directory'];
  iacProvider: IacProviderOption;
}
