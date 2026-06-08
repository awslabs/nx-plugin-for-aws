/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Versons for TypeScript dependencies added by generators
 */
export const TS_VERSIONS = {
  '@a2a-js/sdk': '0.3.13',
  '@aws/aws-distro-opentelemetry-node-autoinstrumentation': '0.11.0',
  '@aws-sdk/client-dynamodb': '3.1063.0',
  '@aws-sdk/client-bedrock-runtime': '3.1063.0',
  '@aws-sdk/client-s3': '3.1063.0',
  '@aws-sdk/client-sts': '3.1063.0',
  '@aws-sdk/credential-providers': '3.1063.0',
  '@aws-sdk/credential-provider-cognito-identity': '3.972.42',
  '@aws-sdk/client-secrets-manager': '3.1063.0',
  '@aws-sdk/rds-signer': '3.1063.0',
  '@aws-smithy/server-apigateway': '1.0.0-alpha.10',
  '@aws-smithy/server-node': '1.0.0-alpha.10',
  '@aws-lambda-powertools/logger': '2.33.1',
  '@aws-lambda-powertools/metrics': '2.33.1',
  '@aws-lambda-powertools/parameters': '2.33.1',
  '@aws-lambda-powertools/tracer': '2.33.1',
  '@aws-lambda-powertools/parser': '2.33.1',
  '@aws-sdk/client-appconfigdata': '3.1063.0',
  '@middy/core': '7.6.5',
  '@nxlv/python': '22.2.0',
  '@nx-extend/terraform': '10.2.1',
  '@nx/devkit': '22.7.5',
  '@nx/react': '22.7.5',
  'create-nx-workspace': '22.7.5',
  '@modelcontextprotocol/sdk': '1.29.0',
  '@modelcontextprotocol/inspector': '0.19.0',
  '@ag-ui/aws-strands': '0.1.0',
  '@ag-ui/client': '0.0.53',
  '@ag-ui/core': '0.0.53',
  '@ag-ui/encoder': '0.0.53',
  'agent-chat-cli': '0.2.0',
  '@copilotkit/react-core': '1.59.5',
  rxjs: '7.8.2',
  '@strands-agents/sdk': '1.4.0',
  '@tanstack/react-router': '1.170.15',
  '@tanstack/router-plugin': '1.168.18',
  '@tanstack/router-generator': '1.167.17',
  '@tanstack/virtual-file-routes': '1.162.0',
  '@tanstack/router-utils': '1.162.2',
  '@cloudscape-design/board-components': '3.0.189',
  '@cloudscape-design/chat-components': '1.0.138',
  '@cloudscape-design/components': '3.0.1308',
  '@cloudscape-design/global-styles': '1.0.59',
  '@tanstack/react-query': '5.101.0',
  '@tanstack/react-query-devtools': '5.101.0',
  '@trpc/tanstack-react-query': '11.17.0',
  '@trpc/client': '11.17.0',
  '@trpc/server': '11.17.0',
  '@types/node': '25.9.2',
  '@types/aws-lambda': '8.10.162',
  '@types/cors': '2.8.19',
  '@types/pg': '8.20.0',
  '@types/ws': '8.18.1',
  '@types/express': '5.0.6',
  '@smithy/config-resolver': '4.5.6',
  '@smithy/node-config-provider': '4.4.6',
  '@smithy/node-http-handler': '4.7.7',
  '@smithy/types': '4.14.3',
  '@vitest/coverage-v8': '4.1.8',
  '@vitest/ui': '4.1.8',
  '@astrojs/react': '5.0.7',
  '@astrojs/starlight': '0.39.3',
  astro: '6.4.4',
  aws4fetch: '1.0.20',
  'aws-cdk': '2.1126.0',
  'aws-cdk-lib': '2.258.0',
  'aws-xray-sdk-core': '3.12.0',
  constructs: '10.6.0',
  cors: '2.8.6',
  chalk: '5.6.2',
  'class-variance-authority': '0.7.1',
  clsx: '2.1.1',
  commander: '14.0.3',
  electrodb: '3.9.0',
  esbuild: '0.28.0',
  'event-source-polyfill': '1.0.31',
  '@types/event-source-polyfill': '1.0.5',
  '@biomejs/biome': '2.4.16',
  '@prisma/adapter-mariadb': '7.8.0',
  '@prisma/adapter-pg': '7.8.0',
  '@prisma/client': '7.8.0',
  express: '5.2.1',
  'fast-glob': '3.3.3',
  husky: '9.1.7',
  'fs-extra': '11.3.5',
  '@types/fs-extra': '11.0.4',
  'make-dir-cli': '4.0.0',
  mariadb: '3.5.2',
  ncp: '2.0.0',
  'npm-check-updates': '19.6.6',
  'oidc-client-ts': '3.5.0',
  pg: '8.21.0',
  prisma: '7.8.0',
  'react-oidc-context': '3.3.1',
  react: '19.2.7',
  'react-dom': '19.2.7',
  rimraf: '6.1.3',
  rolldown: '1.0.3',
  'simple-git': '3.36.0',
  'source-map-support': '0.5.21',
  'starlight-blog': '0.26.1',
  tailwindcss: '4.2.2',
  '@tailwindcss/vite': '4.2.2',
  tsx: '4.22.4',
  'lucide-react': '1.17.0',
  'radix-ui': '1.5.0',
  shadcn: '4.10.0',
  'tw-animate-css': '1.4.0',
  'tailwind-merge': '3.6.0',
  vite: '8.0.16',
  typescript: '6.0.3',
  vitest: '4.1.8',
  zod: '4.4.3',
  ws: '8.21.0',
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
  'ag-ui-protocol': '==0.1.19',
  'ag-ui-strands': '==0.1.9',
  'aws-lambda-powertools': '==3.29.0',
  'aws-lambda-powertools[tracer]': '==3.29.0',
  'aws-lambda-powertools[parser]': '==3.29.0',
  'aws-opentelemetry-distro': '==0.17.1',
  'bedrock-agentcore': '==1.14.0',
  boto3: '==1.43.24',
  checkov: '==3.2.533',
  fastapi: '==0.136.3',
  'fastapi[standard]': '==0.136.3',
  httpx: '==0.28.1',
  mcp: '==1.27.2',
  'pip-check-updates': '==0.28.0',
  'pip-licenses': '==5.5.5',
  'strands-agents': '==1.42.0',
  'strands-agents[a2a]': '==1.42.0',
  'strands-agents-tools': '==0.8.0',
  ty: '==0.0.44',
  uvicorn: '==0.49.0',
} as const;
export type IPyDepVersion = keyof typeof PY_VERSIONS;

/**
 * Add versions to the given dependencies
 */
export const withPyVersions = (deps: IPyDepVersion[]) =>
  deps.map((dep) => `${dep}${PY_VERSIONS[dep]}`);

/**
 * Versions for vendored tools
 */
export const VENDORED_VERSIONS = {
  'git-secrets': '1.3.0',
} as const;
