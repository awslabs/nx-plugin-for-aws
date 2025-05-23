/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// TypeScript Project Generator
export { tsProjectGenerator } from '../src/ts/lib/generator';
export type { TsProjectGeneratorSchema } from '../src/ts/lib/schema';

// TypeScript Infrastructure
export { tsInfraGenerator } from '../src/infra/app/generator';
export type { TsInfraGeneratorSchema } from '../src/infra/app/schema';

// TypeScript MCP Server Generator
export { tsMcpServerGenerator } from '../src/ts/mcp-server/generator';
export type { TsMcpServerGeneratorSchema } from '../src/ts/mcp-server/schema';

// TypeScript Nx Generator Generator
export { tsNxGeneratorGenerator } from '../src/ts/nx-generator/generator';
export type { TsNxGeneratorGeneratorSchema } from '../src/ts/nx-generator/schema';

// TypeScript CloudScape Website Generator
export { tsCloudScapeWebsiteGenerator } from '../src/cloudscape-website/app/generator';
export type { TsCloudScapeWebsiteGeneratorSchema } from '../src/cloudscape-website/app/schema';

// TypeScript CloudScape Website Auth Generator
export { tsCloudScapeWebsiteAuthGenerator } from '../src/cloudscape-website/cognito-auth/generator';
export type { TsCloudScapeWebsiteAuthGeneratorSchema } from '../src/cloudscape-website/cognito-auth/schema';

// Runtime Config
export { runtimeConfigGenerator } from '../src/cloudscape-website/runtime-config/generator';
export type { RuntimeConfigGeneratorSchema } from '../src/cloudscape-website/runtime-config/schema';

// TypeScript tRPC API
export { tsTrpcApiGenerator } from '../src/trpc/backend/generator';
export type { TsTrpcApiGeneratorSchema } from '../src/trpc/backend/schema';

// Shared Constructs
export { sharedConstructsGenerator } from '../src/utils/shared-constructs';
