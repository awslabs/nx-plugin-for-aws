/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// A py#dynamodb table exposes the same construct members and module outputs as
// a ts#dynamodb one, so the printed code is the same.
export {
  cdkDynamoDBContainerWiring,
  dataStoreNames,
  dynamoDBContainerWiringMessage,
  terraformDynamoDBContainerWiring,
} from '../../../ts/dynamodb/container-connection/wiring.js';
