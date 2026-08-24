/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// TypeScript Infrastructure
export { tsInfraGenerator } from '../infra/app/generator.js';
export type { TsInfraGeneratorSchema } from '../infra/app/schema';
// TypeScript Agent Generator
export { tsAgentGenerator } from '../ts/agent/generator.js';
export type { TsAgentGeneratorSchema } from '../ts/agent/schema';
// TypeScript API
export { tsApiGenerator } from '../ts/api/generator.js';
export type { TsApiGeneratorSchema } from '../ts/api/schema';
// Astro Documentation Site Generator
export { tsAstroDocsGenerator } from '../ts/astro-docs/generator.js';
export type { TsAstroDocsGeneratorSchema } from '../ts/astro-docs/schema';
// TypeScript DCR Proxy Generator
export { tsDcrProxyGenerator } from '../ts/dcr-proxy/generator.js';
export type { TsDcrProxyGeneratorSchema } from '../ts/dcr-proxy/schema';
// Documentation Site Generator
export { tsDocsGenerator } from '../ts/docs/generator.js';
export type { TsDocsGeneratorSchema } from '../ts/docs/schema';
// DynamoDB Generator
export { tsDynamoDBGenerator } from '../ts/dynamodb/generator.js';
export type { TsDynamoDBGeneratorSchema } from '../ts/dynamodb/schema';
// TypeScript Lambda Function
export { tsLambdaFunctionGenerator } from '../ts/lambda-function/generator.js';
export type { TsLambdaFunctionGeneratorSchema } from '../ts/lambda-function/schema';
// TypeScript Project Generator
export { tsProjectGenerator } from '../ts/lib/generator.js';
export type { TsProjectGeneratorSchema } from '../ts/lib/schema';
// TypeScript MCP Server Generator
export { tsMcpServerGenerator } from '../ts/mcp-server/generator.js';
export type { TsMcpServerGeneratorSchema } from '../ts/mcp-server/schema';
// TypeScript Nx Generator Generator
export { tsNxGeneratorGenerator } from '../ts/nx-generator/generator.js';
export type { TsNxGeneratorGeneratorSchema } from '../ts/nx-generator/schema';
// TypeScript Nx Migration Generator
export { tsNxMigrationGenerator } from '../ts/nx-migration/generator.js';
export type { TsNxMigrationGeneratorSchema } from '../ts/nx-migration/schema';
// TypeScript Nx Plugin Generator
export { tsNxPluginGenerator } from '../ts/nx-plugin/generator.js';
export type { TsNxPluginGeneratorSchema } from '../ts/nx-plugin/schema';
// Relational Database Generator
export { tsRdbGenerator } from '../ts/rdb/generator.js';
export type { TsRdbGeneratorSchema } from '../ts/rdb/schema';
// Runtime Config
export { runtimeConfigGenerator } from '../ts/react-website/runtime-config/generator.js';
export type { RuntimeConfigGeneratorSchema } from '../ts/react-website/runtime-config/schema';
// TypeScript Website Generator
export { tsWebsiteGenerator } from '../ts/website/app/generator.js';
export type { TsWebsiteGeneratorSchema } from '../ts/website/app/schema';
// TypeScript Website Auth Generator
export { tsWebsiteAuthGenerator } from '../ts/website/auth/generator.js';
export type { TsWebsiteAuthGeneratorSchema } from '../ts/website/auth/schema';

// Shared Constructs
export { sharedConstructsGenerator } from '../utils/shared-constructs.js';
