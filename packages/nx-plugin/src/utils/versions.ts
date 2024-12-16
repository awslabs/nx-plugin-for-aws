/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
export const VERSIONS = {
  '@aws-cdk/aws-cognito-identitypool-alpha': '^2.166.0-alpha.0',
  '@aws-northstar/ui': '^1.1.13',
  '@aws-sdk/client-wafv2': '^3.687.0',
  '@aws/pdk': '^0.25.11',
  '@aws-lambda-powertools/logger': '^2.11.0',
  '@aws-lambda-powertools/metrics': '^2.11.0',
  '@aws-lambda-powertools/tracer': '^2.11.0',
  '@cloudscape-design/board-components': '^3.0.84',
  '@cloudscape-design/components': '^3.0.823',
  '@tanstack/react-query': '^5.59.20',
  '@trpc/react-query': '11.0.0-rc.630',
  '@trpc/client': '11.0.0-rc.630',
  '@trpc/server': '11.0.0-rc.630',
  '@types/aws-lambda': '^8.10.145',
  '@types/react': '^18.3.1',
  '@typespec/compiler': '^0.62.0',
  '@typespec/http': '^0.62.0',
  '@typespec/openapi': '^0.62.0',
  '@typespec/openapi3': '^0.62.0',
  '@nx/vite': '^20.1.1',
  'aws-cdk': '^2.166.0',
  'aws-cdk-lib': '^2.166.0',
  'aws-xray-sdk-core': '^3.10.2',
  'cdk-nag': '^2.32.2',
  constructs: '^10.4.2',
  esbuild: '^0.24.0',
  react: '^18.3.1',
  'react-router-dom': '^6.28.0',
  'source-map-support': '^0.5.21',
  tsx: '^4.19.2',
  zod: '^3.23.8',
} as const;

/**
 * Add versions to the given dependencies
 */
export const withVersions = (deps: (keyof typeof VERSIONS)[]) =>
  Object.fromEntries(deps.map((dep) => [dep, VERSIONS[dep]]));
