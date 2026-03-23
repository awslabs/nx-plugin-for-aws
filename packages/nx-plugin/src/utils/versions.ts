/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Versons for TypeScript dependencies added by generators
 */
export const TS_VERSIONS = {
  '@aws/aws-distro-opentelemetry-node-autoinstrumentation': '0.9.0',
  '@aws-sdk/client-dynamodb': '3.1014.0',
  '@aws-sdk/client-sts': '3.1014.0',
  '@aws-sdk/credential-providers': '3.1014.0',
  '@aws-smithy/server-apigateway': '1.0.0-alpha.10',
  '@aws-smithy/server-node': '1.0.0-alpha.10',
  '@aws-lambda-powertools/logger': '2.32.0',
  '@aws-lambda-powertools/metrics': '2.32.0',
  '@aws-lambda-powertools/parameters': '2.32.0',
  '@aws-lambda-powertools/tracer': '2.32.0',
  '@aws-lambda-powertools/parser': '2.32.0',
  '@aws-sdk/client-appconfigdata': '3.1014.0',
  '@middy/core': '6.4.5',
  '@nxlv/python': '22.1.1',
  '@nx-extend/terraform': '9.0.1',
  '@nx/devkit': '22.6.1',
  '@nx/react': '22.6.1',
  'create-nx-workspace': '22.6.1',
  '@modelcontextprotocol/sdk': '1.27.1',
  '@modelcontextprotocol/inspector': '0.19.0',
  '@strands-agents/sdk': '0.7.0',
  '@tanstack/react-router': '1.168.1',
  '@tanstack/router-plugin': '1.167.2',
  '@tanstack/router-generator': '1.166.15',
  '@tanstack/virtual-file-routes': '1.161.7',
  '@tanstack/router-utils': '1.161.6',
  '@cloudscape-design/board-components': '3.0.153',
  '@cloudscape-design/components': '3.0.1242',
  '@cloudscape-design/global-styles': '1.0.52',
  '@tanstack/react-query': '5.94.5',
  '@tanstack/react-query-devtools': '5.94.5',
  '@trpc/tanstack-react-query': '11.14.1',
  '@trpc/client': '11.14.1',
  '@trpc/server': '11.14.1',
  '@types/node': '22.19.15',
  '@types/aws-lambda': '8.10.161',
  '@types/cors': '2.8.19',
  '@types/ws': '8.18.1',
  '@types/express': '5.0.6',
  '@smithy/types': '4.13.1',
  '@vitest/coverage-v8': '4.1.0',
  '@vitest/ui': '4.1.0',
  aws4fetch: '1.0.20',
  'aws-cdk': '2.1112.0',
  'aws-cdk-lib': '2.244.0',
  '@aws-cdk/aws-bedrock-agentcore-alpha': '2.244.0-alpha.0',
  'aws-xray-sdk-core': '3.12.0',
  constructs: '10.5.1',
  cors: '2.8.6',
  'class-variance-authority': '0.7.1',
  clsx: '2.1.1',
  electrodb: '3.7.2',
  esbuild: '0.27.4',
  'event-source-polyfill': '1.0.31',
  '@types/event-source-polyfill': '1.0.5',
  'eslint-plugin-prettier': '5.5.5',
  express: '5.2.1',
  'jsonc-eslint-parser': '2.4.2',
  'make-dir-cli': '4.0.0',
  ncp: '2.0.0',
  'npm-check-updates': '19.6.5',
  'oidc-client-ts': '3.5.0',
  prettier: '3.8.1',
  'react-oidc-context': '3.3.1',
  react: '19.2.4',
  'react-dom': '19.2.4',
  rimraf: '6.1.3',
  rolldown: '1.0.0-rc.10',
  'source-map-support': '0.5.21',
  tailwindcss: '4.2.2',
  '@tailwindcss/vite': '4.2.2',
  tsx: '4.21.0',
  'lucide-react': '0.577.0',
  'radix-ui': '1.4.3',
  shadcn: '3.8.5',
  'tw-animate-css': '1.4.0',
  'tailwind-merge': '3.5.0',
  vite: '7.3.1',
  vitest: '4.1.0',
  'vite-tsconfig-paths': '5.1.4',
  zod: '4.3.6',
  ws: '8.20.0',
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
  'aws-lambda-powertools': '==3.26.0',
  'aws-lambda-powertools[tracer]': '==3.26.0',
  'aws-lambda-powertools[parser]': '==3.26.0',
  'aws-opentelemetry-distro': '==0.16.0',
  'bedrock-agentcore': '==0.1.7',
  boto3: '==1.42.73',
  checkov: '==3.2.510',
  fastapi: '==0.135.1',
  'fastapi[standard]': '==0.135.1',
  mcp: '==1.26.0',
  'pip-check-updates': '==0.28.0',
  'strands-agents': '==1.32.0',
  'strands-agents-tools': '==0.2.23',
  uvicorn: '==0.42.0',
} as const;
export type IPyDepVersion = keyof typeof PY_VERSIONS;

/**
 * Add versions to the given dependencies
 */
export const withPyVersions = (deps: IPyDepVersion[]) =>
  deps.map((dep) => `${dep}${PY_VERSIONS[dep]}`);
