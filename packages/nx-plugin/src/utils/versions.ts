/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Versons for TypeScript dependencies added by generators
 */
export const TS_VERSIONS = {
  '@cdklabs/cdk-validator-cfnguard': '0.0.60',
  '@aws-sdk/client-cognito-identity': '3.876.0',
  '@aws-sdk/credential-providers': '3.876.0',
  '@aws-sdk/credential-provider-cognito-identity': '3.876.0',
  '@aws-sdk/client-bedrock-agentcore-control': '3.876.0',
  '@aws-lambda-powertools/logger': '2.25.2',
  '@aws-lambda-powertools/metrics': '2.25.2',
  '@aws-lambda-powertools/tracer': '2.25.2',
  '@aws-lambda-powertools/parser': '2.25.2',
  '@middy/core': '6.4.4',
  '@nxlv/python': '21.2.0',
  '@nx-extend/terraform': '9.0.0',
  '@nx/devkit': '21.4.1',
  '@modelcontextprotocol/sdk': '1.17.4',
  '@modelcontextprotocol/inspector': '0.16.5',
  '@tanstack/react-router': '1.131.28',
  '@tanstack/router-plugin': '1.131.28',
  '@tanstack/router-generator': '1.131.28',
  '@tanstack/virtual-file-routes': '1.131.2',
  '@tanstack/router-utils': '1.131.2',
  '@cloudscape-design/board-components': '3.0.117',
  '@cloudscape-design/components': '3.0.1075',
  '@cloudscape-design/global-styles': '1.0.45',
  '@tanstack/react-query': '5.85.5',
  '@tanstack/react-query-devtools': '5.85.5',
  '@trpc/tanstack-react-query': '11.0.0',
  '@trpc/client': '11.0.0',
  '@trpc/server': '11.0.0',
  '@types/node': '22.18.0',
  '@types/aws-lambda': '8.10.152',
  '@types/cors': '2.8.19',
  '@types/express': '5.0.3',
  '@smithy/types': '4.3.2',
  aws4fetch: '1.0.20',
  'aws-cdk': '2.1027.0',
  'aws-cdk-lib': '2.213.0',
  'aws-xray-sdk-core': '3.10.3',
  constructs: '10.4.2',
  cors: '2.8.5',
  esbuild: '0.25.9',
  'eslint-plugin-prettier': '5.5.4',
  express: '5.1.0',
  'jsonc-eslint-parser': '2.4.0',
  'make-dir-cli': '4.0.0',
  'oidc-client-ts': '3.3.0',
  prettier: '3.6.2',
  'react-oidc-context': '3.3.0',
  'source-map-support': '0.5.21',
  tailwindcss: '4.1.12',
  '@tailwindcss/vite': '4.1.12',
  tsx: '4.20.1', // https://github.com/privatenumber/tsx/issues/727
  'vite-tsconfig-paths': '5.1.4',
  zod: '4.1.5',
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
  'aws-lambda-powertools': '==3.19.0',
  'aws-lambda-powertools[tracer]': '==3.19.0',
  'aws-lambda-powertools[parser]': '==3.19.0',
  'aws-opentelemetry-distro': '==0.12.0',
  'bedrock-agentcore': '==0.1.2',
  boto3: '==1.40.20',
  checkov: '==3.2.469',
  fastapi: '==0.116.1',
  'fastapi[standard]': '==0.116.1',
  mangum: '==0.19.0',
  mcp: '==1.13.1',
  'strands-agents': '==1.6.0',
  'strands-agents-tools': '==0.2.5',
} as const;
export type IPyDepVersion = keyof typeof PY_VERSIONS;

/**
 * Add versions to the given dependencies
 */
export const withPyVersions = (deps: IPyDepVersion[]) =>
  deps.map((dep) => `${dep}${PY_VERSIONS[dep]}`);
