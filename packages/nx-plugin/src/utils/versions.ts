/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Versons for TypeScript dependencies added by generators
 */
export const TS_VERSIONS = {
  '@cdklabs/cdk-validator-cfnguard': '^0.0.60',
  '@aws-sdk/client-cognito-identity': '^3.775.0',
  '@aws-sdk/credential-providers': '^3.775.0',
  '@aws-sdk/credential-provider-cognito-identity': '^3.775.0',
  '@aws-sdk/client-bedrock-agentcore-control': '^3.848.0',
  '@aws-lambda-powertools/logger': '^2.24.1',
  '@aws-lambda-powertools/metrics': '^2.24.1',
  '@aws-lambda-powertools/tracer': '^2.24.1',
  '@aws-lambda-powertools/parser': '^2.24.1',
  '@middy/core': '^6.0.0',
  '@nxlv/python': '~21.2.0',
  '@nx-extend/terraform': '^9.0.0',
  '@nx/devkit': '~21.4.1',
  '@modelcontextprotocol/sdk': '^1.11.3',
  '@modelcontextprotocol/inspector': '^0.16.5',
  '@tanstack/react-router': '^1.121.16',
  '@tanstack/router-plugin': '^1.121.16',
  '@tanstack/router-generator': '^1.121.16',
  '@tanstack/virtual-file-routes': '^1.120.17',
  '@tanstack/router-utils': '^1.121.0',
  '@cloudscape-design/board-components': '^3.0.94',
  '@cloudscape-design/components': '^3.0.928',
  '@cloudscape-design/global-styles': '^1.0.38',
  '@tanstack/react-query': '^5.74.3',
  '@tanstack/react-query-devtools': '^5.84.2',
  '@trpc/tanstack-react-query': '11.0.0',
  '@trpc/client': '11.0.0',
  '@trpc/server': '11.0.0',
  '@types/node': '^22.13.13',
  '@types/aws-lambda': '^8.10.148',
  '@types/cors': '^2.8.18',
  '@types/express': '^5.0.3',
  '@smithy/types': '^4.2.0',
  aws4fetch: '^1.0.20',
  'aws-cdk': '^2.1006.0',
  'aws-cdk-lib': '^2.207.0',
  'aws-xray-sdk-core': '^3.10.3',
  constructs: '^10.4.2',
  cors: '^2.8.5',
  esbuild: '^0.25.1',
  'eslint-plugin-prettier': '^5.2.5',
  express: '^5.1.0',
  'jsonc-eslint-parser': '^2.4.0',
  'oidc-client-ts': '^3.2.0',
  prettier: '^3.5.3',
  'react-oidc-context': '^3.2.0',
  'source-map-support': '^0.5.21',
  tailwindcss: '^4.1.11',
  '@tailwindcss/vite': '^4.1.11',
  tsx: '4.20.1', // https://github.com/privatenumber/tsx/issues/727
  'vite-tsconfig-paths': '^5.1.4',
  zod: '^4.0.14',
  // TODO: remove zod-v3 when @modelcontextprotocol/sdk upgrades to Zod v4 or standard schema
  // https://github.com/modelcontextprotocol/typescript-sdk/issues/164
  'zod-v3': 'npm:zod@^3',
} as const;
export type ITsDepVersion = keyof typeof TS_VERSIONS;

/**
 * Add versions to the given dependencies
 */
export const withVersions = (deps: ITsDepVersion[]) =>
  Object.fromEntries(deps.map((dep) => [dep, TS_VERSIONS[dep]]));

/**
 * Versions for Python dependencies added by generators
 */
export const PY_VERSIONS = {
  'aws-lambda-powertools': '~=3.19.0',
  'aws-lambda-powertools[tracer]': '~=3.19.0',
  'aws-lambda-powertools[parser]': '~=3.19.0',
  'aws-opentelemetry-distro': '~=0.11.0',
  'bedrock-agentcore': '~=0.1.2',
  boto3: '~=1.40.14',
  fastapi: '~=0.116.1',
  'fastapi[standard]': '~=0.116.1',
  mangum: '~=0.19.0',
  mcp: '~=1.13.0',
  'strands-agents': '~=1.5.0',
  'strands-agents-tools': '~=0.2.4',
} as const;
export type IPyDepVersion = keyof typeof PY_VERSIONS;

/**
 * Add versions to the given dependencies
 */
export const withPyVersions = (deps: IPyDepVersion[]) =>
  deps.map((dep) => `${dep}${PY_VERSIONS[dep]}`);
