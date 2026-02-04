/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Versons for TypeScript dependencies added by generators
 */
export const TS_VERSIONS = {
  '@aws-sdk/client-cognito-identity': '3.980.0',
  '@aws-sdk/client-dynamodb': '3.980.0',
  '@aws-sdk/credential-providers': '3.980.0',
  '@aws-sdk/credential-provider-cognito-identity': '3.972.3',
  '@aws-smithy/server-apigateway': '1.0.0-alpha.10',
  '@aws-smithy/server-node': '1.0.0-alpha.10',
  '@aws-lambda-powertools/logger': '2.30.2',
  '@aws-lambda-powertools/metrics': '2.30.2',
  '@aws-lambda-powertools/tracer': '2.30.2',
  '@aws-lambda-powertools/parser': '2.30.2',
  '@middy/core': '6.4.5',
  '@nxlv/python': '21.3.1',
  '@nx-extend/terraform': '9.0.1',
  '@nx/devkit': '22.4.3',
  '@nx/react': '22.4.3',
  'create-nx-workspace': '22.4.3',
  '@modelcontextprotocol/sdk': '1.25.3',
  '@modelcontextprotocol/inspector': '0.19.0',
  '@strands-agents/sdk': '0.2.0',
  '@tanstack/react-router': '1.157.16',
  '@tanstack/router-plugin': '1.157.16',
  '@tanstack/router-generator': '1.157.16',
  '@tanstack/virtual-file-routes': '1.154.7',
  '@tanstack/router-utils': '1.154.7',
  '@cloudscape-design/board-components': '3.0.146',
  '@cloudscape-design/components': '3.0.1188',
  '@cloudscape-design/global-styles': '1.0.50',
  '@tanstack/react-query': '5.90.20',
  '@tanstack/react-query-devtools': '5.91.3',
  '@trpc/tanstack-react-query': '11.9.0',
  '@trpc/client': '11.9.0',
  '@trpc/server': '11.9.0',
  '@types/node': '22.19.7',
  '@types/aws-lambda': '8.10.160',
  '@types/cors': '2.8.19',
  '@types/ws': '8.18.1',
  '@types/express': '5.0.6',
  '@smithy/types': '4.12.0',
  aws4fetch: '1.0.20',
  'aws-cdk': '2.1104.0',
  'aws-cdk-lib': '2.236.0',
  '@aws-cdk/aws-bedrock-agentcore-alpha': '2.236.0-alpha.0',
  'aws-xray-sdk-core': '3.12.0',
  constructs: '10.4.5',
  cors: '2.8.6',
  'class-variance-authority': '0.7.1',
  clsx: '2.1.1',
  electrodb: '3.5.3',
  esbuild: '0.27.2',
  'eslint-plugin-prettier': '5.5.5',
  express: '5.2.1',
  'jsonc-eslint-parser': '2.4.2',
  'make-dir-cli': '4.0.0',
  ncp: '2.0.0',
  'npm-check-updates': '19.3.2',
  'oidc-client-ts': '3.4.1',
  prettier: '3.8.1',
  'react-oidc-context': '3.3.0',
  react: '19.2.4',
  'react-dom': '19.2.4',
  rimraf: '6.1.2',
  rolldown: '1.0.0-rc.1',
  'source-map-support': '0.5.21',
  tailwindcss: '4.1.18',
  '@tailwindcss/vite': '4.1.18',
  tsx: '4.21.0',
  'lucide-react': '0.563.0',
  'radix-ui': '1.4.3',
  shadcn: '3.8.0',
  'tw-animate-css': '1.4.0',
  'tailwind-merge': '3.4.0',
  'vite-tsconfig-paths': '5.1.4',
  zod: '4.3.6',
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
  'aws-opentelemetry-distro': '==0.14.2',
  'bedrock-agentcore': '==0.1.7',
  boto3: '==1.42.42',
  checkov: '==3.2.500',
  fastapi: '==0.128.1',
  'fastapi[standard]': '==0.128.1',
  mangum: '==0.21.0',
  mcp: '==1.26.0',
  'pip-check-updates': '==0.28.0',
  'strands-agents': '==1.24.0',
  'strands-agents-tools': '==0.2.19',
  uvicorn: '==0.40.0',
} as const;
export type IPyDepVersion = keyof typeof PY_VERSIONS;

/**
 * Add versions to the given dependencies
 */
export const withPyVersions = (deps: IPyDepVersion[]) =>
  deps.map((dep) => `${dep}${PY_VERSIONS[dep]}`);
