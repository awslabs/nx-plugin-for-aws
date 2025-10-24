/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Versons for TypeScript dependencies added by generators
 */
export const TS_VERSIONS = {
  '@aws-sdk/client-cognito-identity': '3.914.0',
  '@aws-sdk/client-dynamodb': '3.914.0',
  '@aws-sdk/credential-providers': '3.914.0',
  '@aws-sdk/credential-provider-cognito-identity': '3.914.0',
  '@aws-smithy/server-apigateway': '1.0.0-alpha.10',
  '@aws-smithy/server-node': '1.0.0-alpha.10',
  '@aws-lambda-powertools/logger': '2.28.0',
  '@aws-lambda-powertools/metrics': '2.28.0',
  '@aws-lambda-powertools/tracer': '2.28.0',
  '@aws-lambda-powertools/parser': '2.28.0',
  '@middy/core': '6.4.5',
  '@nxlv/python': '21.2.0',
  '@nx-extend/terraform': '9.0.0',
  '@nx/devkit': '21.6.5',
  'create-nx-workspace': '21.6.5',
  '@modelcontextprotocol/sdk': '1.20.1',
  '@modelcontextprotocol/inspector': '0.17.1',
  '@tanstack/react-router': '1.133.21',
  '@tanstack/router-plugin': '1.133.21',
  '@tanstack/router-generator': '1.133.20',
  '@tanstack/virtual-file-routes': '1.133.19',
  '@tanstack/router-utils': '1.133.19',
  '@cloudscape-design/board-components': '3.0.123',
  '@cloudscape-design/components': '3.0.1114',
  '@cloudscape-design/global-styles': '1.0.46',
  '@tanstack/react-query': '5.90.5',
  '@tanstack/react-query-devtools': '5.90.2',
  '@trpc/tanstack-react-query': '11.6.0',
  '@trpc/client': '11.6.0',
  '@trpc/server': '11.6.0',
  '@types/node': '22.18.12',
  '@types/aws-lambda': '8.10.156',
  '@types/cors': '2.8.19',
  '@types/express': '5.0.3',
  '@smithy/types': '4.8.0',
  aws4fetch: '1.0.20',
  'aws-cdk': '2.1030.0',
  'aws-cdk-lib': '2.220.0',
  'aws-xray-sdk-core': '3.11.0',
  constructs: '10.4.2',
  cors: '2.8.5',
  electrodb: '3.5.0',
  esbuild: '0.25.11',
  'eslint-plugin-prettier': '5.5.4',
  express: '5.1.0',
  'jsonc-eslint-parser': '2.4.1',
  'make-dir-cli': '4.0.0',
  ncp: '2.0.0',
  'npm-check-updates': '19.1.1',
  'oidc-client-ts': '3.3.0',
  prettier: '3.6.2',
  'react-oidc-context': '3.3.0',
  rimraf: '6.0.1',
  rolldown: '1.0.0-beta.44',
  'source-map-support': '0.5.21',
  tailwindcss: '4.1.15',
  '@tailwindcss/vite': '4.1.15',
  tsx: '4.20.6', // https://github.com/privatenumber/tsx/issues/727
  'vite-tsconfig-paths': '5.1.4',
  zod: '4.1.12',
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
  'aws-lambda-powertools': '==3.22.0',
  'aws-lambda-powertools[tracer]': '==3.22.0',
  'aws-lambda-powertools[parser]': '==3.22.0',
  'aws-opentelemetry-distro': '==0.12.2',
  'bedrock-agentcore': '==0.1.7',
  boto3: '==1.40.59',
  checkov: '==3.2.487',
  fastapi: '==0.120.0',
  'fastapi[standard]': '==0.120.0',
  mangum: '==0.19.0',
  mcp: '==1.19.0',
  'pip-check-updates': '==0.27.0',
  'strands-agents': '==1.13.0',
  'strands-agents-tools': '==0.2.12',
  uvicorn: '==0.38.0',
} as const;
export type IPyDepVersion = keyof typeof PY_VERSIONS;

/**
 * Add versions to the given dependencies
 */
export const withPyVersions = (deps: IPyDepVersion[]) =>
  deps.map((dep) => `${dep}${PY_VERSIONS[dep]}`);
