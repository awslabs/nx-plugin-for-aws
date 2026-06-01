/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { runCLI, RunCmdOpts } from '../utils';

const AUTH_TYPES = ['iam', 'cognito', 'custom'] as const;
const INFRA_TYPES = ['rest-lambda', 'http-lambda'] as const;
const INTEGRATION_PATTERNS = ['isolated', 'shared'] as const;

const SHORT_INFRA: Record<(typeof INFRA_TYPES)[number], string> = {
  'http-lambda': 'http',
  'rest-lambda': 'rest',
};

export const generateApiProjectPermutations = async (
  generator: string,
  namePrefix: string,
  sep = '-',
  opts?: RunCmdOpts,
) => {
  for (const auth of AUTH_TYPES) {
    for (const infra of INFRA_TYPES) {
      for (const integrationPattern of INTEGRATION_PATTERNS) {
        const name = [
          namePrefix,
          auth,
          SHORT_INFRA[infra],
          integrationPattern,
        ].join(sep);
        await runCLI(
          `generate @aws/nx-plugin:${generator} --name=${name} --auth=${auth} --infra=${infra} --integrationPattern=${integrationPattern} --no-interactive`,
          opts,
        );
      }
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
    for (const infra of INFRA_TYPES) {
      for (const integrationPattern of INTEGRATION_PATTERNS) {
        const name = [
          namePrefix,
          auth,
          SHORT_INFRA[infra],
          integrationPattern,
        ].join(sep);
        await runCLI(
          `generate @aws/nx-plugin:connection --sourceProject=${sourceProject} --targetProject=${name} --no-interactive`,
          opts,
        );
      }
    }
  }
};
