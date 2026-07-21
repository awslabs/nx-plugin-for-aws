/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Versons for TypeScript dependencies added by generators
 */
export const TS_VERSIONS = {
  '@a2a-js/sdk': '0.3.14',
  '@aws/aws-distro-opentelemetry-node-autoinstrumentation': '0.12.0',
  '@aws-sdk/client-dynamodb': '3.1090.0',
  '@aws-sdk/client-bedrock-runtime': '3.1090.0',
  '@aws-sdk/client-s3': '3.1090.0',
  '@aws-sdk/client-sts': '3.1090.0',
  '@aws-sdk/credential-providers': '3.1090.0',
  '@aws-sdk/credential-provider-cognito-identity': '3.972.58',
  '@aws-sdk/client-secrets-manager': '3.1090.0',
  '@aws-sdk/rds-signer': '3.1090.0',
  '@aws-smithy/server-apigateway': '1.0.0-alpha.10',
  '@aws-smithy/server-node': '1.0.0-alpha.10',
  '@aws-lambda-powertools/logger': '2.34.0',
  '@aws-lambda-powertools/metrics': '2.34.0',
  '@aws-lambda-powertools/parameters': '2.34.0',
  '@aws-lambda-powertools/tracer': '2.34.0',
  '@aws-lambda-powertools/parser': '2.34.0',
  '@aws-sdk/client-appconfigdata': '3.1090.0',
  '@middy/core': '7.7.0',
  '@nxlv/python': '22.2.2',
  '@nx-extend/terraform': '10.3.0',
  '@nx/devkit': '23.1.0',
  '@nx/react': '23.1.0',
  'create-nx-workspace': '23.1.0',
  '@swc-node/register': '1.12.1',
  '@swc/core': '1.15.43',
  '@modelcontextprotocol/sdk': '1.29.0',
  '@modelcontextprotocol/inspector': '0.22.0',
  '@ag-ui/a2ui-toolkit': '0.0.4',
  '@ag-ui/aws-strands': '0.2.3',
  '@ag-ui/client': '0.0.57',
  '@ag-ui/core': '0.0.57',
  '@ag-ui/encoder': '0.0.57',
  'agent-chat-cli': '0.3.0',
  '@copilotkit/react-core': '1.63.1',
  rxjs: '7.8.2',
  '@strands-agents/sdk': '1.10.0',
  '@tanstack/react-router': '1.170.18',
  '@tanstack/router-plugin': '1.168.22',
  '@tanstack/router-generator': '1.167.21',
  '@tanstack/virtual-file-routes': '1.162.0',
  '@tanstack/router-utils': '1.162.2',
  '@cloudscape-design/board-components': '3.0.205',
  '@cloudscape-design/chat-components': '1.0.151',
  '@cloudscape-design/components': '3.0.1330',
  '@cloudscape-design/global-styles': '1.0.62',
  '@tanstack/react-query': '5.101.2',
  '@tanstack/react-query-devtools': '5.101.2',
  '@trpc/tanstack-react-query': '11.18.0',
  '@trpc/client': '11.18.0',
  '@trpc/server': '11.18.0',
  '@types/node': '26.1.1',
  '@types/aws-lambda': '8.10.162',
  '@types/cors': '2.8.19',
  '@types/pg': '8.20.0',
  '@types/ws': '8.18.1',
  '@types/express': '5.0.6',
  '@smithy/config-resolver': '4.6.10',
  '@smithy/node-config-provider': '4.5.10',
  '@smithy/node-http-handler': '4.9.7',
  '@smithy/types': '4.16.1',
  '@vitest/coverage-v8': '4.1.10',
  '@vitest/ui': '4.1.10',
  '@astrojs/react': '6.0.1',
  '@astrojs/starlight': '0.41.3',
  astro: '7.1.1',
  aws4fetch: '1.0.20',
  'aws-cdk': '2.1132.0',
  'aws-cdk-lib': '2.261.0',
  'aws-xray-sdk-core': '3.12.0',
  constructs: '10.7.0',
  cors: '2.8.6',
  chalk: '5.6.2',
  'class-variance-authority': '0.7.1',
  clsx: '2.1.1',
  commander: '15.0.0',
  electrodb: '3.9.1',
  esbuild: '0.28.1',
  'event-source-polyfill': '1.0.31',
  '@types/event-source-polyfill': '1.0.5',
  '@biomejs/biome': '2.5.4',
  '@prisma/adapter-mariadb': '7.8.0',
  '@prisma/adapter-pg': '7.8.0',
  '@prisma/client': '7.8.0',
  ejs: '6.0.1',
  '@types/ejs': '3.1.5',
  express: '5.2.1',
  'fast-glob': '3.3.3',
  husky: '9.1.7',
  'fs-extra': '11.3.6',
  '@types/fs-extra': '11.0.4',
  'make-dir-cli': '4.0.0',
  mariadb: '3.5.3',
  ncp: '2.0.0',
  npm: '12.0.1',
  'npm-check-updates': '22.2.9',
  'oidc-client-ts': '3.5.0',
  pg: '8.22.0',
  prisma: '7.8.0',
  'react-oidc-context': '3.3.1',
  react: '19.2.7',
  'react-dom': '19.2.7',
  rimraf: '6.1.3',
  rolldown: '1.2.0',
  'simple-git': '3.36.0',
  'source-map-support': '0.5.21',
  'starlight-blog': '0.28.0',
  tailwindcss: '4.3.3',
  '@tailwindcss/vite': '4.3.3',
  tsx: '4.23.1',
  'lucide-react': '1.25.0',
  'radix-ui': '1.6.2',
  shadcn: '4.13.1',
  'tw-animate-css': '1.4.0',
  'tailwind-merge': '3.6.0',
  vite: '8.1.5',
  typescript: '6.0.3',
  vitest: '4.1.10',
  zod: '4.4.3',
  ws: '8.21.1',
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
  'a2a-sdk': '==0.3.26',
  'ag-ui-langgraph': '==0.0.42',
  'ag-ui-protocol': '==0.1.19',
  'ag-ui-strands': '==0.2.2',
  'aws-lambda-powertools': '==3.31.1',
  'aws-lambda-powertools[tracer]': '==3.31.1',
  'aws-lambda-powertools[parser]': '==3.31.1',
  'aws-opentelemetry-distro': '==0.18.0',
  'bedrock-agentcore': '==1.18.1',
  boto3: '==1.43.51',
  checkov: '==3.3.8',
  fastapi: '==0.139.2',
  'fastapi[standard]': '==0.139.2',
  httpx: '==0.28.1',
  langchain: '==1.3.14',
  'langchain-aws': '==1.6.2',
  'langchain-mcp-adapters': '==0.3.0',
  langgraph: '==1.2.9',
  mcp: '==1.28.1',
  'pip-check-updates': '==0.29.0',
  'pip-licenses': '==5.5.5',
  ruff: '==0.15.22',
  'strands-agents': '==1.48.0',
  'strands-agents[a2a]': '==1.48.0',
  'strands-agents-tools': '==0.8.4',
  ty: '==0.0.61',
  pynamodb: '==6.1.0',
  uvicorn: '==0.51.0',
  sqlmodel: '==0.0.39',
  alembic: '==1.18.5',
  aiomysql: '==0.3.2',
  asyncpg: '==0.31.0',
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

/**
 * Base container images used by generated Dockerfiles. Pinned exactly so
 * generated images are reproducible, and chosen to be free of known
 * HIGH/CRITICAL vulnerabilities at time of generation.
 */
export const BASE_IMAGES = {
  node: 'public.ecr.aws/docker/library/node:lts-slim',
  python: 'public.ecr.aws/docker/library/python:3.14-slim',
} as const;

/**
 * Versions for container tooling used by generated image build/scan targets.
 * Pinned exactly so generated images are reproducible.
 */
export const CONTAINER_VERSIONS = {
  // ECR-hosted Trivy image used to scan built images during the build.
  trivy: '0.72.0',
} as const;

/**
 * Exact versions for Terraform providers used by generated `.tf` modules.
 * Pinned exactly (no range operator) so generated infrastructure is reproducible.
 */
export const TERRAFORM_VERSIONS = {
  aws: '6.55.0',
  random: '3.9.0',
  null: '3.3.0',
  archive: '2.8.0',
  external: '2.4.0',
  local: '2.9.0',
} as const;
export type ITerraformProviderVersion = keyof typeof TERRAFORM_VERSIONS;

/**
 * Substitution variables exposing Terraform provider version constraints to
 * generated `.tf` templates (e.g. `version = "<%- awsProviderVersion %>"`)
 */
export const terraformProviderVersions = () => ({
  awsProviderVersion: TERRAFORM_VERSIONS.aws,
  randomProviderVersion: TERRAFORM_VERSIONS.random,
  nullProviderVersion: TERRAFORM_VERSIONS.null,
  archiveProviderVersion: TERRAFORM_VERSIONS.archive,
  externalProviderVersion: TERRAFORM_VERSIONS.external,
  localProviderVersion: TERRAFORM_VERSIONS.local,
});
