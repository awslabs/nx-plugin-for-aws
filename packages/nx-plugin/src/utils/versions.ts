/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Versons for TypeScript dependencies added by generators
 */
export const TS_VERSIONS = {
  '@a2a-js/sdk': '0.3.13',
  '@aws/aws-distro-opentelemetry-node-autoinstrumentation': '0.10.0',
  '@aws-sdk/client-dynamodb': '3.1037.0',
  '@aws-sdk/client-bedrock-runtime': '3.1037.0',
  '@aws-sdk/client-sts': '3.1037.0',
  '@aws-sdk/credential-providers': '3.1037.0',
  '@aws-smithy/server-apigateway': '1.0.0-alpha.10',
  '@aws-smithy/server-node': '1.0.0-alpha.10',
  '@aws-lambda-powertools/logger': '2.33.0',
  '@aws-lambda-powertools/metrics': '2.33.0',
  '@aws-lambda-powertools/parameters': '2.33.0',
  '@aws-lambda-powertools/tracer': '2.33.0',
  '@aws-lambda-powertools/parser': '2.33.0',
  '@aws-sdk/client-appconfigdata': '3.1037.0',
  '@middy/core': '7.3.3',
  '@nxlv/python': '22.1.3',
  '@nx-extend/terraform': '10.2.1',
  '@nx/devkit': '22.7.0',
  '@nx/react': '22.7.0',
  'create-nx-workspace': '22.7.0',
  '@modelcontextprotocol/sdk': '1.29.0',
  '@modelcontextprotocol/inspector': '0.19.0',
  '@ag-ui/client': '0.0.52',
  '@copilotkit/react-core': '1.56.3',
  rxjs: '7.8.2',
  '@strands-agents/sdk': '1.0.0-rc.5',
  '@tanstack/react-router': '1.168.24',
  '@tanstack/router-plugin': '1.167.27',
  '@tanstack/router-generator': '1.166.35',
  '@tanstack/virtual-file-routes': '1.161.7',
  '@tanstack/router-utils': '1.161.7',
  '@cloudscape-design/board-components': '3.0.174',
  '@cloudscape-design/chat-components': '1.0.120',
  '@cloudscape-design/components': '3.0.1284',
  '@cloudscape-design/global-styles': '1.0.57',
  '@tanstack/react-query': '5.100.5',
  '@tanstack/react-query-devtools': '5.100.5',
  '@trpc/tanstack-react-query': '11.16.0',
  '@trpc/client': '11.16.0',
  '@trpc/server': '11.16.0',
  '@types/node': '25.6.0',
  '@types/aws-lambda': '8.10.161',
  '@types/cors': '2.8.19',
  '@types/ws': '8.18.1',
  '@types/express': '5.0.6',
  '@smithy/node-http-handler': '4.6.1',
  '@smithy/types': '4.14.1',
  '@vitest/coverage-v8': '4.1.5',
  '@vitest/ui': '4.1.5',
  '@astrojs/react': '5.0.4',
  '@astrojs/starlight': '0.38.4',
  astro: '6.1.9',
  aws4fetch: '1.0.20',
  'aws-cdk': '2.1119.0',
  'aws-cdk-lib': '2.251.0',
  '@aws-cdk/aws-bedrock-agentcore-alpha': '2.251.0-alpha.0',
  'aws-xray-sdk-core': '3.12.0',
  constructs: '10.6.0',
  cors: '2.8.6',
  chalk: '5.6.2',
  'class-variance-authority': '0.7.1',
  clsx: '2.1.1',
  commander: '14.0.3',
  electrodb: '3.7.5',
  esbuild: '0.28.0',
  'event-source-polyfill': '1.0.31',
  '@types/event-source-polyfill': '1.0.5',
  '@typescript-eslint/eslint-plugin': '8.59.0',
  '@typescript-eslint/parser': '8.59.0',
  'eslint-plugin-prettier': '5.5.5',
  express: '5.2.1',
  'fast-glob': '3.3.3',
  'fs-extra': '11.3.4',
  '@types/fs-extra': '11.0.4',
  'jsonc-eslint-parser': '3.1.0',
  'typescript-eslint': '8.59.0',
  'make-dir-cli': '4.0.0',
  ncp: '2.0.0',
  'npm-check-updates': '19.6.6',
  'oidc-client-ts': '3.5.0',
  prettier: '3.8.3',
  'react-oidc-context': '3.3.1',
  react: '19.2.5',
  'react-dom': '19.2.5',
  rimraf: '6.1.3',
  rolldown: '1.0.0-rc.15',
  'simple-git': '3.36.0',
  'source-map-support': '0.5.21',
  'starlight-blog': '0.26.1',
  tailwindcss: '4.2.2',
  '@tailwindcss/vite': '4.2.2',
  tsx: '4.21.0',
  'lucide-react': '1.11.0',
  'radix-ui': '1.4.3',
  shadcn: '4.5.0',
  'tw-animate-css': '1.4.0',
  'tailwind-merge': '3.5.0',
  vite: '8.0.8',
  typescript: '6.0.3',
  vitest: '4.1.5',
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
  'ag-ui-protocol': '==0.1.18',
  'ag-ui-strands': '==0.1.7',
  'aws-lambda-powertools': '==3.28.0',
  'aws-lambda-powertools[tracer]': '==3.28.0',
  'aws-lambda-powertools[parser]': '==3.28.0',
  'aws-opentelemetry-distro': '==0.17.0',
  'bedrock-agentcore': '==1.6.4',
  boto3: '==1.42.97',
  checkov: '==3.2.525',
  fastapi: '==0.136.1',
  'fastapi[standard]': '==0.136.1',
  httpx: '==0.28.1',
  mcp: '==1.27.0',
  'pip-check-updates': '==0.28.0',
  'strands-agents': '==1.37.0',
  'strands-agents[a2a]': '==1.37.0',
  'strands-agents-tools': '==0.5.1',
  uvicorn: '==0.46.0',
} as const;
export type IPyDepVersion = keyof typeof PY_VERSIONS;

/**
 * Add versions to the given dependencies
 */
export const withPyVersions = (deps: IPyDepVersion[]) =>
  deps.map((dep) => `${dep}${PY_VERSIONS[dep]}`);
