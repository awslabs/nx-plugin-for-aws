/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Versons for TypeScript dependencies added by generators
 */
export const TS_VERSIONS = {
  '@aws-sdk/client-cognito-identity': '3.968.0',
  '@aws-sdk/client-dynamodb': '3.968.0',
  '@aws-sdk/credential-providers': '3.968.0',
  '@aws-sdk/credential-provider-cognito-identity': '3.968.0',
  '@aws-smithy/server-apigateway': '1.0.0-alpha.10',
  '@aws-smithy/server-node': '1.0.0-alpha.10',
  '@aws-lambda-powertools/logger': '2.30.2',
  '@aws-lambda-powertools/metrics': '2.30.2',
  '@aws-lambda-powertools/tracer': '2.30.2',
  '@aws-lambda-powertools/parser': '2.30.2',
  '@middy/core': '6.4.5',
  '@nxlv/python': '21.2.3',
  '@nx-extend/terraform': '9.0.1',
  '@nx/devkit': '22.4.1',
  '@nx/react': '22.4.1',
  'create-nx-workspace': '22.4.1',
  '@modelcontextprotocol/sdk': '1.25.2',
  '@modelcontextprotocol/inspector': '0.18.0',
  '@strands-agents/sdk': '0.1.5',
  '@tanstack/react-router': '1.149.3',
  '@tanstack/router-plugin': '1.149.3',
  '@tanstack/router-generator': '1.149.3',
  '@tanstack/virtual-file-routes': '1.145.4',
  '@tanstack/router-utils': '1.143.11',
  '@cloudscape-design/board-components': '3.0.140',
  '@cloudscape-design/components': '3.0.1173',
  '@cloudscape-design/global-styles': '1.0.49',
  '@tanstack/react-query': '5.90.16',
  '@tanstack/react-query-devtools': '5.91.2',
  '@trpc/tanstack-react-query': '11.8.1',
  '@trpc/client': '11.8.1',
  '@trpc/server': '11.8.1',
  '@types/node': '22.19.6',
  '@types/aws-lambda': '8.10.159',
  '@types/cors': '2.8.19',
  '@types/ws': '8.18.1',
  '@types/express': '5.0.6',
  '@smithy/types': '4.12.0',
  aws4fetch: '1.0.20',
  'aws-cdk': '2.1100.3',
  'aws-cdk-lib': '2.234.1',
  '@aws-cdk/aws-bedrock-agentcore-alpha': '2.233.0-alpha.0',
  'aws-xray-sdk-core': '3.12.0',
  constructs: '10.4.4',
  cors: '2.8.5',
  electrodb: '3.5.3',
  esbuild: '0.27.2',
  'eslint-plugin-prettier': '5.5.4',
  express: '5.2.1',
  'jsonc-eslint-parser': '2.4.2',
  'make-dir-cli': '4.0.0',
  ncp: '2.0.0',
  'npm-check-updates': '19.3.1',
  'oidc-client-ts': '3.4.1',
  prettier: '3.7.4',
  'react-oidc-context': '3.3.0',
  react: '19.2.3',
  'react-dom': '19.2.3',
  rimraf: '6.1.2',
  rolldown: '1.0.0-beta.52',
  'source-map-support': '0.5.21',
  tailwindcss: '4.1.18',
  '@tailwindcss/vite': '4.1.18',
  tsx: '4.21.0',
  'vite-tsconfig-paths': '5.1.4',
  zod: '4.3.5',
  ws: '8.19.0',
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
  'aws-lambda-powertools': '==3.24.0',
  'aws-lambda-powertools[tracer]': '==3.24.0',
  'aws-lambda-powertools[parser]': '==3.24.0',
  'aws-opentelemetry-distro': '==0.14.1',
  'bedrock-agentcore': '==0.1.7',
  boto3: '==1.42.30',
  checkov: '==3.2.497',
  fastapi: '==0.128.0',
  'fastapi[standard]': '==0.128.0',
  mangum: '==0.20.0',
  mcp: '==1.25.0',
  'pip-check-updates': '==0.28.0',
  'strands-agents': '==1.22.0',
  'strands-agents-tools': '==0.2.19',
  uvicorn: '==0.40.0',
} as const;
export type IPyDepVersion = keyof typeof PY_VERSIONS;

/**
 * Add versions to the given dependencies
 */
export const withPyVersions = (deps: IPyDepVersion[]) =>
  deps.map((dep) => `${dep}${PY_VERSIONS[dep]}`);
