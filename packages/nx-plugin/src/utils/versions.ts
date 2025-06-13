/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export const VERSIONS = {
  '@cdklabs/cdk-validator-cfnguard': '^0.0.60',
  '@aws-sdk/client-cognito-identity': '^3.775.0',
  '@aws-sdk/credential-providers': '^3.775.0',
  '@aws-sdk/credential-provider-cognito-identity': '^3.775.0',
  '@aws-lambda-powertools/logger': '^2.17.0',
  '@aws-lambda-powertools/metrics': '^2.17.0',
  '@aws-lambda-powertools/tracer': '^2.17.0',
  '@nxlv/python': '^21.0.0',
  '@nx/devkit': '~21.0.3',
  '@modelcontextprotocol/sdk': '^1.11.3',
  '@tanstack/react-router': '^1.114.27',
  '@tanstack/router-plugin': '^1.114.27',
  '@cloudscape-design/board-components': '^3.0.94',
  '@cloudscape-design/components': '^3.0.928',
  '@cloudscape-design/global-styles': '^1.0.38',
  '@tanstack/react-query': '^5.74.3',
  '@trpc/tanstack-react-query': '11.0.0',
  '@trpc/client': '11.0.0',
  '@trpc/server': '11.0.0',
  '@types/node': '^22.13.13',
  '@types/aws-lambda': '^8.10.148',
  '@types/cors': '^2.8.18',
  '@smithy/types': '^4.2.0',
  aws4fetch: '^1.0.20',
  'aws-cdk': '^2.1006.0',
  'aws-cdk-lib': '^2.200.0',
  'aws-xray-sdk-core': '^3.10.3',
  constructs: '^10.4.2',
  cors: '^2.8.5',
  esbuild: '^0.25.1',
  'eslint-plugin-prettier': '^5.2.5',
  'jsonc-eslint-parser': '^2.4.0',
  'oidc-client-ts': '^3.2.0',
  prettier: '^3.5.3',
  'react-oidc-context': '^3.2.0',
  'source-map-support': '^0.5.21',
  tsx: '4.20.1', // https://github.com/privatenumber/tsx/issues/727
  'vite-tsconfig-paths': '^5.1.4',
  zod: '^3.25.50',
} as const;

/**
 * Add versions to the given dependencies
 */
export const withVersions = (deps: (keyof typeof VERSIONS)[]) =>
  Object.fromEntries(deps.map((dep) => [dep, VERSIONS[dep]]));
