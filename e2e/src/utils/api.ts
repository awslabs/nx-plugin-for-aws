/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { runCLI, RunCmdOpts } from '../utils';

const AUTH_TYPES = ['IAM', 'Cognito', 'None'] as const;
const COMPUTE_TYPES = [
  'ServerlessApiGatewayRestApi',
  'ServerlessApiGatewayHttpApi',
] as const;

const SHORT_COMPUTE_TYPES: Record<(typeof COMPUTE_TYPES)[number], string> = {
  ServerlessApiGatewayHttpApi: 'http',
  ServerlessApiGatewayRestApi: 'rest',
};

export const generateApiProjectPermutations = async (
  generator: string,
  namePrefix: string,
  sep = '-',
  opts?: RunCmdOpts,
) => {
  for (const auth of AUTH_TYPES) {
    for (const computeType of COMPUTE_TYPES) {
      const name = [
        namePrefix,
        auth.toLowerCase(),
        SHORT_COMPUTE_TYPES[computeType],
      ].join(sep);
      await runCLI(
        `generate @aws/nx-plugin:${generator} --name=${name} --auth=${auth} --computeType=${computeType} --no-interactive`,
        opts,
      );
    }
  }
};

export const connectApiProjectPermutations = async (
  sourceProject: string,
  namePrefix: string,
  sep = '-',
  opts?: RunCmdOpts,
) => {
  for (const auth of AUTH_TYPES) {
    for (const computeType of COMPUTE_TYPES) {
      const name = [
        namePrefix,
        auth.toLowerCase(),
        SHORT_COMPUTE_TYPES[computeType],
      ].join(sep);
      await runCLI(
        `generate @aws/nx-plugin:api-connection --sourceProject=${sourceProject} --targetProject=${name} --no-interactive`,
        opts,
      );
    }
  }
};
