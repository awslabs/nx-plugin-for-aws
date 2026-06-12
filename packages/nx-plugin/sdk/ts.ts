/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// TypeScript Infrastructure
export { tsInfraGenerator } from '../src/infra/app/generator';
export type { TsInfraGeneratorSchema } from '../src/infra/app/schema';
// TypeScript Smithy API
export { tsSmithyApiGenerator } from '../src/smithy/ts/api/generator';
export type { TsSmithyApiGeneratorSchema } from '../src/smithy/ts/api/schema';
// TypeScript tRPC API
export { tsTrpcApiGenerator } from '../src/trpc/backend/generator';
export type { TsTrpcApiGeneratorSchema } from '../src/trpc/backend/schema';
// TypeScript Agent Generator
export { tsAgentGenerator } from '../src/ts/agent/generator';
export type { TsAgentGeneratorSchema } from '../src/ts/agent/schema';
// TypeScript API
export { tsApiGenerator } from '../src/ts/api/generator';
export type { TsApiGeneratorSchema } from '../src/ts/api/schema';

// Documentation Site Generator
export { tsDocsGenerator } from '../src/ts/docs/generator';
export type { TsDocsGeneratorSchema } from '../src/ts/docs/schema';
// DynamoDB Generator
export { tsDynamoDBGenerator } from '../src/ts/dynamodb/generator';
export type { TsDynamoDBGeneratorSchema } from '../src/ts/dynamodb/schema';
// TypeScript Lambda Function
export { tsLambdaFunctionGenerator } from '../src/ts/lambda-function/generator';
export type { TsLambdaFunctionGeneratorSchema } from '../src/ts/lambda-function/schema';
// TypeScript Project Generator
export { tsProjectGenerator } from '../src/ts/lib/generator';
export type { TsProjectGeneratorSchema } from '../src/ts/lib/schema';
// TypeScript MCP Server Generator
export { tsMcpServerGenerator } from '../src/ts/mcp-server/generator';
export type { TsMcpServerGeneratorSchema } from '../src/ts/mcp-server/schema';

// TypeScript Nx Generator Generator
export { tsNxGeneratorGenerator } from '../src/ts/nx-generator/generator';
export type { TsNxGeneratorGeneratorSchema } from '../src/ts/nx-generator/schema';

// TypeScript Nx Plugin Generator
export { tsNxPluginGenerator } from '../src/ts/nx-plugin/generator';
export type { TsNxPluginGeneratorSchema } from '../src/ts/nx-plugin/schema';
// Relational Database Generator
export { tsRdbGenerator } from '../src/ts/rdb/generator';
export type { TsRdbGeneratorSchema } from '../src/ts/rdb/schema';
// TypeScript React Website Generator
export { tsReactWebsiteGenerator } from '../src/ts/react-website/app/generator';
export type { TsReactWebsiteGeneratorSchema } from '../src/ts/react-website/app/schema';
// TypeScript React Website Auth Generator
export { tsReactWebsiteAuthGenerator } from '../src/ts/react-website/cognito-auth/generator';
export type { TsReactWebsiteAuthGeneratorSchema } from '../src/ts/react-website/cognito-auth/schema';
// Runtime Config
export { runtimeConfigGenerator } from '../src/ts/react-website/runtime-config/generator';
export type { RuntimeConfigGeneratorSchema } from '../src/ts/react-website/runtime-config/schema';
// TypeScript Website Generator
export { tsWebsiteGenerator } from '../src/ts/website/app/generator';
export type { TsWebsiteGeneratorSchema } from '../src/ts/website/app/schema';
// TypeScript Website Auth Generator
export { tsWebsiteAuthGenerator } from '../src/ts/website/auth/generator';
export type { TsWebsiteAuthGeneratorSchema } from '../src/ts/website/auth/schema';

// Shared Constructs
export { sharedConstructsGenerator } from '../src/utils/shared-constructs';
