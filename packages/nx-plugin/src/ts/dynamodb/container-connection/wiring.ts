/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */
import { terraformRolePolicy } from '../../../connection/container-connection.js';
import type {
  DataStoreNames,
  ServiceWiringNames,
} from '../../rdb/container-connection/wiring.js';

export { dataStoreNames } from '../../rdb/container-connection/wiring.js';

/**
 * The code a user adds to their CDK stack so the service may read and write
 * the table. The guides show it for `MyService` and `MyTable`, which the specs
 * check.
 */
export const cdkDynamoDBContainerWiring = (
  service: ServiceWiringNames,
  table: DataStoreNames,
): string =>
  `${table.variableName}.grantReadWriteData(${service.variableName}.taskRole);`;

/**
 * The same access for the root Terraform module, on the service's task role:
 * the DynamoDB actions on the table and its indexes, and use of its KMS key.
 */
export const terraformDynamoDBContainerWiring = (
  service: ServiceWiringNames,
  table: DataStoreNames,
): string =>
  terraformRolePolicy({
    label: `${service.moduleName}_${table.moduleName}_access`,
    role: `module.${service.moduleName}.task_role_name`,
    statements: [
      `{
  Effect = "Allow"
  Action = [
    "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
    "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan",
    "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem",
  ]
  Resource = [
    module.${table.moduleName}.table_arn,
    "\${module.${table.moduleName}.table_arn}/index/*",
  ]
},`,
      `{
  Effect = "Allow"
  Action = [
    "kms:Encrypt",
    "kms:Decrypt",
    "kms:ReEncrypt*",
    "kms:GenerateDataKey*",
    "kms:DescribeKey",
  ]
  Resource = [module.${table.moduleName}.kms_key_arn]
},`,
    ],
  });

/**
 * What the DynamoDB connection generators print. They do not edit the user's
 * stack or root module, so this tells the user what to add there.
 */
export const dynamoDBContainerWiringMessage = (
  service: ServiceWiringNames & { iac?: string },
  table: DataStoreNames,
): string => {
  const intro = `Let the ${service.nameClassName} container service read and write the ${table.className} table.`;
  const missing = `Until you add it, the service's requests to the table are denied.`;
  return service.iac === 'terraform'
    ? `${intro} Add this to the root Terraform module that deploys both, for example packages/infra/src/main.tf, where module "${service.moduleName}" deploys the service and module "${table.moduleName}" deploys the table. ${missing}

${terraformDynamoDBContainerWiring(service, table)}`
    : `${intro} Add this to your stack, for example packages/infra/src/stacks/application-stack.ts, where ${service.variableName} is your ${service.nameClassName} construct and ${table.variableName} is your ${table.className} construct. ${missing}

${cdkDynamoDBContainerWiring(service, table)}`;
};
